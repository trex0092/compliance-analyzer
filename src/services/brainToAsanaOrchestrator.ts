/**
 * Brain → Asana Orchestrator  (WEAPONIZED)
 *
 * Master dispatcher that converts ANY WeaponizedBrainResponse into a full
 * Asana task tree — parent task, subtasks per finding, subtasks per filing
 * obligation, ESG subtasks, and a 24-hour freeze countdown task when needed.
 *
 * Verdict routing:
 *   freeze    → CRITICAL parent + 24h countdown subtask + EOCN notification subtask
 *   escalate  → HIGH parent + CO assignment + EDD subtask
 *   flag      → MEDIUM parent + review subtask
 *   pass      → INFO task (skipped unless passThrough=true)
 *
 * Regulatory: FDL No.10/2025 Art.20-21 (CO duties), Art.24 (5yr retention),
 *             Art.26-27 (STR filing), Cabinet Res 74/2020 Art.4-7 (24h freeze),
 *             Cabinet Res 71/2024 (penalty exposure).
 */

import type { WeaponizedBrainResponse } from './weaponizedBrain';
import {
  createAsanaTask,
  isAsanaConfigured,
  type AsanaTaskPayload,
} from './asanaClient';
import { enqueueRetry } from './asanaQueue';
import { buildComplianceCustomFields } from './asanaCustomFields';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AsanaOrchestratorConfig {
  projectGid: string;
  workspaceGid: string;
  /** GID of the MLRO / default assignee for freeze/escalate tasks */
  mlroGid?: string;
  /** GID of the Compliance Officer */
  coGid?: string;
  /** If true, also create Asana tasks for 'pass' verdicts */
  syncPassVerdicts?: boolean;
  /** Custom field GID map (optional — uses buildComplianceCustomFields if omitted) */
  customFieldGids?: Record<string, string>;
}

export interface OrchestratorResult {
  entityId: string;
  verdict: string;
  parentTaskGid?: string;
  subtasksCreated: number;
  tasksQueued: number;
  errors: string[];
  summary: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_EMOJI: Record<string, string> = {
  freeze: '🔴',
  escalate: '🟠',
  flag: '🟡',
  pass: '🟢',
};

const URGENCY_DAYS: Record<string, number> = {
  freeze: 0,    // due today
  escalate: 1,
  flag: 3,
  pass: 7,
};

function dueDateFromVerdict(verdict: string): string {
  const d = new Date();
  d.setDate(d.getDate() + (URGENCY_DAYS[verdict] ?? 3));
  return d.toISOString().split('T')[0];
}

function buildParentTask(
  brain: WeaponizedBrainResponse,
  cfg: AsanaOrchestratorConfig,
): AsanaTaskPayload {
  const v = brain.finalVerdict;
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const entityName = brain.mega.entity?.name ?? entityId;
  const emoji = PRIORITY_EMOJI[v] ?? '⚪';

  const customFields = buildComplianceCustomFields({
    verdict: v,
    confidence: brain.confidence,
    riskScore: brain.extensions.explanation?.score,
    cddLevel: brain.extensions.explanation?.cddLevel,
    sanctionsFlag: v === 'freeze',
    esgGrade: brain.extensions.esgScore?.grade,
  });

  return {
    name: `${emoji} [${v.toUpperCase()}] Compliance Screening — ${entityName} — ${new Date().toISOString().split('T')[0]}`,
    notes: [
      `**Entity:** ${entityName} (${entityId})`,
      `**Verdict:** ${v.toUpperCase()}`,
      `**Confidence:** ${(brain.confidence * 100).toFixed(1)}%`,
      `**Clamp Reasons:** ${brain.clampReasons.length > 0 ? brain.clampReasons.join(' | ') : 'none'}`,
      `**Subsystem Failures:** ${brain.subsystemFailures.length > 0 ? brain.subsystemFailures.join(', ') : 'none'}`,
      `**Requires Human Review:** ${brain.requiresHumanReview}`,
      '',
      '**Audit Narrative:**',
      brain.auditNarrative,
    ].join('\n'),
    due_on: dueDateFromVerdict(v),
    assignee: v === 'freeze' || v === 'escalate' ? cfg.mlroGid : cfg.coGid,
    projects: [cfg.projectGid],
    tags: ['compliance-screening', v, entityId],
    custom_fields: customFields,
  };
}

function buildFreezeCountdownSubtask(entityId: string, mlroGid?: string): AsanaTaskPayload {
  const deadline = new Date(Date.now() + 24 * 3_600_000);
  return {
    name: `⏱ 24h EOCN FREEZE DEADLINE — ${entityId} — due ${deadline.toISOString()}`,
    notes: [
      '## IMMEDIATE ACTION REQUIRED — Cabinet Res 74/2020 Art.4',
      '',
      '1. Execute asset freeze immediately',
      '2. Notify EOCN within 24 clock hours of confirmation',
      '3. File CNMR within 5 business days (goAML form CNMR_V3)',
      '4. DO NOT notify the subject (FDL No.10/2025 Art.29 — tipping off offence)',
      '5. Four-eyes approval required: CO + Senior Management',
      '',
      `**Deadline:** ${deadline.toISOString()}`,
      '**Penalty for miss:** AED 100K–100M + criminal liability (Cabinet Res 71/2024)',
    ].join('\n'),
    due_on: new Date().toISOString().split('T')[0],
    assignee: mlroGid,
    tags: ['URGENT', 'eocn-freeze', '24h-deadline'],
  };
}

function buildEddSubtask(entityId: string, cddLevel: string, coGid?: string): AsanaTaskPayload {
  return {
    name: `📋 EDD Required — ${entityId} — ${cddLevel} → EDD`,
    notes: [
      `Enhanced Due Diligence triggered for entity ${entityId}.`,
      '',
      '**Actions required:**',
      '- Verify source of funds and wealth (Cabinet Res 134/2025 Art.9)',
      '- Obtain senior management approval before proceeding',
      '- Complete EDD within 3-month review cycle',
      '- Re-screen against all 6 sanctions lists',
      '- Document rationale for CDD level change',
      '',
      '**Regulatory ref:** Cabinet Res 134/2025 Art.9-14; FDL No.10/2025 Art.12-14',
    ].join('\n'),
    due_on: dueDateFromVerdict('escalate'),
    assignee: coGid,
    tags: ['edd', 'cdd-review', entityId],
  };
}

function buildStrSubtask(entityId: string, classification: string, dueDate: string | null, mlroGid?: string): AsanaTaskPayload {
  return {
    name: `📤 ${classification} Filing Required — ${entityId}`,
    notes: [
      `**Filing Type:** ${classification}`,
      `**Entity:** ${entityId}`,
      `**Deadline:** ${dueDate ?? 'See regulatory calendar'}`,
      '',
      '**Actions:**',
      `- Prepare ${classification} via goAML`,
      '- Four-eyes review: CO + MLRO',
      '- DO NOT notify subject (FDL Art.29)',
      '- Retain filing record for 5 years (FDL Art.24)',
      '',
      `**Regulatory ref:** FDL No.10/2025 Art.26-27; MoE Circular 08/AML/2021`,
    ].join('\n'),
    due_on: dueDate?.split('T')[0] ?? dueDateFromVerdict('escalate'),
    assignee: mlroGid,
    tags: [classification.toLowerCase(), 'filing', entityId],
  };
}

function buildEsgSubtask(entityId: string, grade: string, riskLevel: string, coGid?: string): AsanaTaskPayload {
  return {
    name: `🌱 ESG Risk — ${entityId} — Grade ${grade} (${riskLevel.toUpperCase()})`,
    notes: [
      `ESG composite grade ${grade} — risk level: ${riskLevel}.`,
      '',
      '**Actions:**',
      '- Review ESG subsystem findings in full compliance report',
      '- Check conflict minerals screening results (OECD DDG / LBMA RGG v9)',
      '- Verify TCFD alignment and carbon footprint disclosure (IFRS S2)',
      '- Address greenwashing findings before next reporting period',
      '',
      '**Regulatory ref:** ISSB IFRS S1/S2; LBMA RGG v9 §6; GRI 2021',
    ].join('\n'),
    due_on: dueDateFromVerdict('flag'),
    assignee: coGid,
    tags: ['esg', `esg-${riskLevel}`, entityId],
  };
}

function buildClampSubtask(clampReason: string, entityId: string, mlroGid?: string): AsanaTaskPayload {
  const isFreeze = clampReason.includes('freeze') || clampReason.includes('FREEZE');
  return {
    name: `⚠ Safety Clamp Fired — ${entityId} — ${clampReason.slice(7, 70)}...`,
    notes: [
      '**Safety clamp triggered by the Weaponized Brain:**',
      '',
      clampReason,
      '',
      '**Action:** Review the clamp reason, verify the underlying data, and confirm or override via four-eyes process.',
    ].join('\n'),
    due_on: dueDateFromVerdict(isFreeze ? 'freeze' : 'escalate'),
    assignee: mlroGid,
    tags: ['safety-clamp', 'brain-alert', entityId],
  };
}

// ─── Main Orchestrator ────────────────────────────────────────────────────────

export async function orchestrateBrainToAsana(
  brain: WeaponizedBrainResponse,
  cfg: AsanaOrchestratorConfig,
): Promise<OrchestratorResult> {
  const entityId = brain.mega.entity?.id ?? 'UNKNOWN';
  const v = brain.finalVerdict;
  const errors: string[] = [];

  if (!cfg.syncPassVerdicts && v === 'pass') {
    return {
      entityId,
      verdict: v,
      subtasksCreated: 0,
      tasksQueued: 0,
      errors: [],
      summary: 'Pass verdict — Asana sync skipped (syncPassVerdicts=false)',
    };
  }

  // Build all task payloads
  const parentPayload = buildParentTask(brain, cfg);
  const subtaskPayloads: AsanaTaskPayload[] = [];

  // Freeze: 24h countdown + EOCN notification
  if (v === 'freeze') {
    subtaskPayloads.push(buildFreezeCountdownSubtask(entityId, cfg.mlroGid));
  }

  // EDD if escalated
  if (v === 'escalate' || v === 'freeze') {
    const cdd = brain.extensions.explanation?.cddLevel ?? 'CDD';
    subtaskPayloads.push(buildEddSubtask(entityId, cdd, cfg.coGid));
  }

  // STR/SAR/CTR classification subtask
  if (brain.extensions.filingClassification &&
      brain.extensions.filingClassification.primaryCategory !== 'NONE') {
    const fc = brain.extensions.filingClassification;
    subtaskPayloads.push(buildStrSubtask(
      entityId,
      fc.primaryCategory,
      fc.deadlineDueDate,
      cfg.mlroGid,
    ));
  }

  // ESG risk subtask
  if (brain.extensions.esgScore && brain.extensions.esgScore.riskLevel !== 'low') {
    subtaskPayloads.push(buildEsgSubtask(
      entityId,
      brain.extensions.esgScore.grade,
      brain.extensions.esgScore.riskLevel,
      cfg.coGid,
    ));
  }

  // Clamp reason subtasks (max 5 most critical)
  for (const reason of brain.clampReasons.slice(0, 5)) {
    subtaskPayloads.push(buildClampSubtask(reason, entityId, cfg.mlroGid));
  }

  // Dispatch
  let parentTaskGid: string | undefined;
  let subtasksCreated = 0;
  let tasksQueued = 0;

  if (isAsanaConfigured()) {
    try {
      const parentResult = await createAsanaTask(parentPayload);
      parentTaskGid = parentResult?.gid;

      for (const sub of subtaskPayloads) {
        try {
          if (parentTaskGid) {
            await createAsanaTask({ ...sub, parent: parentTaskGid });
            subtasksCreated++;
          }
        } catch (subErr) {
          // Queue for retry
          enqueueRetry({ ...sub, parent: parentTaskGid });
          tasksQueued++;
          errors.push(`Subtask queued for retry: ${sub.name.slice(0, 60)}`);
        }
      }
    } catch (err) {
      // Queue parent for retry
      enqueueRetry(parentPayload);
      tasksQueued++;
      errors.push(`Parent task queued: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    // Asana not configured — queue everything
    enqueueRetry(parentPayload);
    tasksQueued++;
    for (const sub of subtaskPayloads) {
      enqueueRetry(sub);
      tasksQueued++;
    }
  }

  const summary =
    `Entity ${entityId} [${v.toUpperCase()}]: ` +
    `parent task ${parentTaskGid ?? 'queued'}, ` +
    `${subtasksCreated} subtask(s) created, ` +
    `${tasksQueued} queued for retry, ` +
    `${errors.length} error(s).`;

  return { entityId, verdict: v, parentTaskGid, subtasksCreated, tasksQueued, errors, summary };
}
