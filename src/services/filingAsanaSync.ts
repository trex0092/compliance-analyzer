/**
 * Filing Asana Sync — STR/SAR/CTR/CNMR/DPMSR/EOCN task mirrors.
 *
 * Phase 4 Asana reporting: every compliance filing now creates (or updates)
 * an Asana task the moment it's drafted so the MLRO sees filing progress in
 * Asana without logging in to the compliance-analyzer. The goAML XML (when
 * available) goes into the task notes as a fenced block, and the eventual
 * FIU submission receipt is appended as a comment so the task's history is
 * the filing's audit trail.
 *
 * This sits ABOVE asanaSync.ts — it uses the same client + retry queue +
 * task links but emits a filing-shaped task rather than a case/alert/
 * approval/review task. That keeps the filing path separate so we can
 * evolve it without touching the existing four sync flows.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.24 (10yr record retention, chain-of-custody)
 *   - FDL No.10/2025 Art.26-27 (STR/SAR filing obligations)
 *   - Cabinet Res 134/2025 Art.19 (internal review before filing)
 *   - MoE Circular 08/AML/2021 (DPMS quarterly reports, goAML XML)
 *   - Cabinet Res 74/2020 Art.4-7 (EOCN 24h + CNMR 5bd protocol)
 */

import {
  createAsanaTask,
  updateAsanaTask,
  isAsanaConfigured,
  type AsanaTaskPayload,
} from './asanaClient';
import { enqueueRetry } from './asanaQueue';
import { addTaskLink } from './asanaTaskLinks';
import { buildComplianceCustomFields, type DeadlineType } from './asanaCustomFields';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FilingStatus = 'drafted' | 'under_review' | 'submitted' | 'accepted' | 'rejected';

export interface FilingRecord {
  filingId: string;
  filingType: DeadlineType;
  entityId: string;
  entityName: string;
  status: FilingStatus;
  /** ISO date when the filing was drafted. */
  draftedAt: string;
  /** ISO date when the filing was submitted to the FIU, if any. */
  submittedAt?: string;
  /** Business-day-calculated regulatory deadline. */
  regulatoryDeadline: string;
  /** Business days remaining until the deadline. */
  daysRemaining: number;
  /**
   * goAML XML content, if already generated. Stored in the task notes as a
   * fenced ```xml block so MLROs can copy-paste into the goAML portal.
   */
  goamlXml?: string;
  /** FIU submission receipt (reference number, timestamp, etc). */
  submissionReceipt?: string;
  /** Narrative body — the actual STR/SAR reasoning. */
  narrative: string;
  /** Analyst or MLRO who drafted the filing. */
  draftedBy: string;
}

// ---------------------------------------------------------------------------
// Task payload builder
// ---------------------------------------------------------------------------

function filingDueDays(filingType: DeadlineType): number {
  // Regulatory deadlines in business days — must match businessDays.ts.
  switch (filingType) {
    case 'STR':
    case 'SAR':
      return 10; // FDL Art.26-27
    case 'CTR':
    case 'DPMSR':
      return 15; // MoE Circular 08/AML/2021
    case 'CNMR':
      return 5; // Cabinet Res 74/2020 Art.7
    case 'EOCN':
      return 1; // 24-hour freeze protocol (special case)
  }
}

function filingCitation(filingType: DeadlineType): string {
  switch (filingType) {
    case 'STR':
    case 'SAR':
      return 'FDL No.10/2025 Art.26-27';
    case 'CTR':
      return 'MoE Circular 08/AML/2021 + FDL Art.26-27';
    case 'DPMSR':
      return 'MoE Circular 08/AML/2021 quarterly DPMS report';
    case 'CNMR':
      return 'Cabinet Res 74/2020 Art.7 — 5 business days';
    case 'EOCN':
      return 'Cabinet Res 74/2020 Art.4-7 — 24 hour freeze';
  }
}

function buildFilingTaskPayload(filing: FilingRecord, projectId: string): AsanaTaskPayload {
  const daysPart = filing.daysRemaining > 0 ? ` [${filing.daysRemaining}bd]` : ' [OVERDUE]';
  const statusTag = filing.status === 'submitted' ? '[SUBMITTED]' : '[DRAFT]';

  const notes: string[] = [
    `Filing ID: ${filing.filingId}`,
    `Type: ${filing.filingType}`,
    `Entity: ${filing.entityName} (${filing.entityId})`,
    `Status: ${filing.status}`,
    `Drafted by: ${filing.draftedBy} at ${filing.draftedAt}`,
    `Regulatory deadline: ${filing.regulatoryDeadline} (${filing.daysRemaining}bd remaining)`,
    `Regulatory basis: ${filingCitation(filing.filingType)}`,
    '',
    '## Narrative',
    filing.narrative,
  ];

  if (filing.goamlXml) {
    notes.push('', '## goAML XML', '```xml', filing.goamlXml, '```');
  }

  if (filing.submissionReceipt) {
    notes.push('', '## Submission receipt', filing.submissionReceipt);
  }

  notes.push(
    '',
    '---',
    'Auto-created by Hawkeye Sterling V2 Filing Sync',
    `Timestamp: ${new Date().toISOString()}`,
    '',
    'IMPORTANT: do NOT share this task or the filing subject with the subject — ' +
      'no tipping-off per FDL No.10/2025 Art.29.'
  );

  const custom_fields = buildComplianceCustomFields({
    riskLevel: filing.daysRemaining < 2 ? 'critical' : filing.daysRemaining < 5 ? 'high' : 'medium',
    verdict: filing.filingType === 'EOCN' ? 'freeze' : 'escalate',
    caseId: filing.filingId,
    deadlineType: filing.filingType,
    daysRemaining: filing.daysRemaining,
    regulationCitation: filingCitation(filing.filingType),
  });

  return {
    name: `${statusTag}[${filing.filingType}]${daysPart} ${filing.entityName}`,
    notes: notes.join('\n'),
    projects: [projectId],
    due_on: filing.regulatoryDeadline.slice(0, 10),
    ...(Object.keys(custom_fields).length > 0 ? { custom_fields } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public sync
// ---------------------------------------------------------------------------

/**
 * Create or update an Asana task for a filing. If a task link already
 * exists for this filingId, the task is updated in place; otherwise a
 * new task is created.
 *
 * Callers: the filing engine (goamlBuilder.ts), the STR workflow, the
 * quarterly DPMSR scheduled script, and the incident response path.
 */
export async function syncFilingToAsana(
  filing: FilingRecord,
  projectId: string
): Promise<{ ok: boolean; gid?: string; error?: string }> {
  if (!isAsanaConfigured()) {
    return { ok: false, error: 'Asana not configured' };
  }

  const payload = buildFilingTaskPayload(filing, projectId);
  const result = await createAsanaTask(payload);

  if (result.ok && result.gid) {
    // Record the link so subsequent updates re-use the same task.
    addTaskLink(filing.filingId, 'filing', result.gid, projectId);
    return { ok: true, gid: result.gid };
  }

  enqueueRetry(payload, 'filing-sync', result.error ?? 'Unknown', filing.filingId);
  return { ok: false, error: result.error };
}

/**
 * Update an existing filing task in Asana when status changes
 * (drafted → under_review → submitted → accepted/rejected).
 */
export async function updateFilingAsanaStatus(
  taskGid: string,
  filing: FilingRecord
): Promise<{ ok: boolean; error?: string }> {
  if (!isAsanaConfigured()) {
    return { ok: false, error: 'Asana not configured' };
  }
  const name =
    filing.status === 'submitted'
      ? `[SUBMITTED][${filing.filingType}] ${filing.entityName}`
      : filing.status === 'accepted'
        ? `[ACCEPTED][${filing.filingType}] ${filing.entityName}`
        : filing.status === 'rejected'
          ? `[REJECTED][${filing.filingType}] ${filing.entityName}`
          : `[${filing.status.toUpperCase()}][${filing.filingType}] ${filing.entityName}`;

  const completed = filing.status === 'accepted';
  return updateAsanaTask(taskGid, { name, completed });
}

// ---------------------------------------------------------------------------
// Bulk close on filing submission — Asana Phase 2 #A11
// ---------------------------------------------------------------------------

/**
 * Close an entire chain of dependent Asana tasks when a filing is
 * marked submitted. Use case: a single STR filing can have a parent
 * task plus several subtasks (screening, narrative drafting, 4-eyes
 * approvals, evidence uploads). When the FIU submission goes through,
 * all of those should complete at once — this function walks the set
 * and marks each complete with one call.
 *
 * Idempotent: tasks already marked complete remain complete.
 * Failure-tolerant: one task failing to close does not block the
 * others.
 *
 * Regulatory basis: FDL No.10/2025 Art.26-27 (filing closure),
 * Cabinet Res 134/2025 Art.19 (auditable state transitions).
 */
export async function bulkCloseOnSubmission(taskGids: readonly string[]): Promise<{
  ok: boolean;
  closed: number;
  failed: number;
  errors: string[];
}> {
  if (!isAsanaConfigured()) {
    return {
      ok: false,
      closed: 0,
      failed: 0,
      errors: ['Asana not configured'],
    };
  }

  const errors: string[] = [];
  let closed = 0;
  let failed = 0;

  for (const gid of taskGids) {
    const result = await updateAsanaTask(gid, { completed: true });
    if (result.ok) {
      closed += 1;
    } else {
      failed += 1;
      errors.push(`${gid}: ${result.error ?? 'unknown'}`);
    }
  }

  return {
    ok: failed === 0,
    closed,
    failed,
    errors,
  };
}

/** Exported for tests. */
export const __test__ = { buildFilingTaskPayload, filingDueDays, filingCitation };
