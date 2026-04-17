/**
 * Asana task sync service — routes compliance tasks to customer-specific Asana projects.
 *
 * Each customer has:
 *   - asanaComplianceProjectGid: for compliance cases, alerts, screening
 *   - asanaWorkflowProjectGid: for workflow tasks, approvals, reviews
 */

import type { ComplianceCase } from '../domain/cases';
import type { CustomerProfile } from '../domain/customers';
import type { ApprovalRequest } from '../domain/approvals';
import type { Alert } from '../domain/alerts';
import type { PeriodicReviewSchedule } from '../domain/periodicReview';
import { COMPANY_REGISTRY } from '../domain/customers';
import {
  createAsanaTask,
  updateAsanaTask,
  isAsanaConfigured,
  type AsanaTaskPayload,
} from './asanaClient';
import { enqueueRetry } from './asanaQueue';
import { addTaskLink } from './asanaTaskLinks';
import { buildComplianceCustomFields, deadlineTypeFromCaseType } from './asanaCustomFields';
import type { DeadlineType, Verdict } from './asanaCustomFields';
import { appendCitationBlock } from './regulatoryCitationEnricher';

const DEFAULT_PROJECT = '1213759768596515';

// ─── Phase 19 W-E wiring — regulatory citation block ────────────────────────
//
// Every task dispatched from this module has the canonical Phase 19 W-E
// citation block appended to its notes unless the escape hatch env var
// ASANA_CITATION_BLOCK_DISABLED is set to "1" / "true". The enricher is
// idempotent (see appendCitationBlock in regulatoryCitationEnricher.ts)
// so repeat dispatches do not double the block.
//
// Default ON. To roll back without a code change, set
// ASANA_CITATION_BLOCK_DISABLED=1 in the Netlify env and redeploy.
//
// Regulatory anchor: FDL No. 10 of 2025 Art.24 (reportable structure at
// task level); Cabinet Resolution 134/2025 Art.19 (internal review
// traceability from task → regulation).

function citationDisabled(): boolean {
  const raw =
    typeof process !== 'undefined' ? process.env?.ASANA_CITATION_BLOCK_DISABLED : undefined;
  if (!raw) return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function maybeAppendCitation(
  existingNotes: string,
  input: {
    verdict: Verdict;
    deadlineType?: DeadlineType;
    caseId?: string;
    tenantId?: string;
    additionalCitations?: readonly string[];
  }
): string {
  if (citationDisabled()) return existingNotes;
  return appendCitationBlock(existingNotes, input);
}

// ─── Project Resolution ─────────────────────────────────────────────────────

function findCustomerByCase(
  caseObj: ComplianceCase
): (typeof COMPANY_REGISTRY)[number] | undefined {
  if (caseObj.linkedCustomerId) {
    return COMPANY_REGISTRY.find((c) => c.id === caseObj.linkedCustomerId);
  }
  // Fallback: match by entity name
  return COMPANY_REGISTRY.find((c) => c.legalName.toLowerCase() === caseObj.entityId.toLowerCase());
}

function getComplianceProject(customer?: (typeof COMPANY_REGISTRY)[number]): string {
  return customer?.asanaComplianceProjectGid || DEFAULT_PROJECT;
}

function getWorkflowProject(customer?: (typeof COMPANY_REGISTRY)[number]): string {
  return customer?.asanaWorkflowProjectGid || DEFAULT_PROJECT;
}

export function resolveProjectForCustomer(
  customerId: string,
  projectType: 'compliance' | 'workflow'
): string {
  const customer = COMPANY_REGISTRY.find((c) => c.id === customerId);
  return projectType === 'compliance'
    ? getComplianceProject(customer)
    : getWorkflowProject(customer);
}

// ─── Due Date Helpers ────────────────────────────────────────────────────────

function dueInDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

function riskToDueDays(riskLevel: string): number {
  switch (riskLevel) {
    case 'critical':
      return 1;
    case 'high':
      return 3;
    case 'medium':
      return 7;
    default:
      return 14;
  }
}

// ─── Task Builders ───────────────────────────────────────────────────────────

function buildCaseTaskPayload(caseObj: ComplianceCase, projectId: string): AsanaTaskPayload {
  const flags = caseObj.redFlags.join(', ');
  const dueDays = riskToDueDays(caseObj.riskLevel);
  const custom_fields = buildComplianceCustomFields({
    riskLevel: caseObj.riskLevel as 'critical' | 'high' | 'medium' | 'low',
    caseId: caseObj.id,
    deadlineType: deadlineTypeFromCaseType(caseObj.caseType),
    daysRemaining: dueDays,
    regulationCitation: 'FDL No.10/2025 Art.12-14 + Cabinet Res 134/2025 Art.7-10',
  });
  const baseNotes = [
    `Case ID: ${caseObj.id}`,
    `Type: ${caseObj.caseType}`,
    `Status: ${caseObj.status}`,
    `Risk: ${caseObj.riskLevel} (score ${caseObj.riskScore})`,
    `Red Flags: ${flags}`,
    `Recommendation: ${caseObj.recommendation}`,
    ``,
    `Narrative: ${caseObj.narrative}`,
    ``,
    `Findings:`,
    ...caseObj.findings.map((f) => `  - ${f}`),
    ``,
    `---`,
    `Auto-created by Hawkeye Sterling V2`,
    `Timestamp: ${new Date().toISOString()}`,
  ].join('\n');
  return {
    name: `[${caseObj.riskLevel.toUpperCase()}] ${caseObj.caseType} — ${caseObj.entityId}`,
    notes: maybeAppendCitation(baseNotes, {
      // Case-builder risk tiers map to the closest verdict. critical/high
      // carry the TFS anchors (escalate); medium/low are flagged.
      verdict:
        caseObj.riskLevel === 'critical' || caseObj.riskLevel === 'high' ? 'escalate' : 'flag',
      deadlineType: deadlineTypeFromCaseType(caseObj.caseType),
      caseId: caseObj.id,
    }),
    projects: [projectId],
    due_on: dueInDays(dueDays),
    ...(Object.keys(custom_fields).length > 0 ? { custom_fields } : {}),
  };
}

function buildAlertTaskPayload(
  alertItem: Alert,
  entityName: string,
  projectId: string
): AsanaTaskPayload {
  const dueDays = alertItem.severity === 'critical' ? 1 : 3;
  const custom_fields = buildComplianceCustomFields({
    riskLevel: alertItem.severity as 'critical' | 'high' | 'medium' | 'low',
    caseId: alertItem.id,
    daysRemaining: dueDays,
    regulationCitation: 'Cabinet Res 134/2025 Art.14 + FATF Rec 10',
  });
  const baseNotes = [
    `Alert ID: ${alertItem.id}`,
    `Type: ${alertItem.type}`,
    `Severity: ${alertItem.severity}`,
    `Subject: ${alertItem.subjectType} / ${alertItem.subjectId}`,
    ``,
    alertItem.message,
    ``,
    `---`,
    `Auto-created by Hawkeye Sterling V2 Alert Engine`,
    `Timestamp: ${alertItem.createdAt}`,
  ].join('\n');
  return {
    name: `[ALERT] ${alertItem.type} — ${entityName}`,
    notes: maybeAppendCitation(baseNotes, {
      verdict:
        alertItem.severity === 'critical' || alertItem.severity === 'high' ? 'escalate' : 'flag',
      caseId: alertItem.id,
    }),
    projects: [projectId],
    due_on: dueInDays(dueDays),
    ...(Object.keys(custom_fields).length > 0 ? { custom_fields } : {}),
  };
}

function buildApprovalTaskPayload(
  approval: ApprovalRequest,
  caseObj: ComplianceCase,
  projectId: string
): AsanaTaskPayload {
  const dueDays = approval.urgency === 'immediate' ? 1 : 2;
  const custom_fields = buildComplianceCustomFields({
    riskLevel: caseObj.riskLevel as 'critical' | 'high' | 'medium' | 'low',
    caseId: approval.caseId,
    daysRemaining: dueDays,
    regulationCitation:
      approval.regulatoryBasis ?? 'Cabinet Res 134/2025 Art.12-14 + 4-Eyes Principle',
  });
  const baseNotes = [
    `Approval ID: ${approval.id}`,
    `Case: ${approval.caseId}`,
    `Required For: ${approval.requiredFor}`,
    `Status: ${approval.status}`,
    `Requested By: ${approval.requestedBy}`,
    `Requested At: ${approval.requestedAt}`,
    ``,
    `Case Risk: ${caseObj.riskLevel} (score ${caseObj.riskScore})`,
    `Recommendation: ${caseObj.recommendation}`,
    ``,
    `Regulatory Basis: ${approval.regulatoryBasis ?? 'Cabinet Resolution 134/2025 Art.12-14 | 4-Eyes Principle'}`,
    approval.urgency === 'immediate' ? `URGENCY: IMMEDIATE — requires action within 24 hours` : '',
    ``,
    `---`,
    `Auto-created by Hawkeye Sterling V2 Approval Workflow`,
  ].join('\n');
  return {
    name: `[APPROVAL] ${approval.requiredFor} — ${caseObj.entityId}`,
    notes: maybeAppendCitation(baseNotes, {
      // Approval tasks are always escalate-grade by definition —
      // they exist because a human gate is required.
      verdict: 'escalate',
      caseId: approval.caseId,
    }),
    projects: [projectId],
    due_on: dueInDays(dueDays),
    ...(Object.keys(custom_fields).length > 0 ? { custom_fields } : {}),
  };
}

function buildReviewTaskPayload(
  review: PeriodicReviewSchedule,
  projectId: string
): AsanaTaskPayload {
  const custom_fields = buildComplianceCustomFields({
    riskLevel: review.riskRating as 'critical' | 'high' | 'medium' | 'low',
    caseId: review.id,
    regulationCitation: 'FDL No.10/2025 Art.12-14 + FATF Rec 10',
  });
  const baseNotes = [
    `Review ID: ${review.id}`,
    `Customer: ${review.customerName} (${review.customerId})`,
    `Risk Rating: ${review.riskRating}`,
    `Review Type: ${review.reviewType}`,
    `Frequency: Every ${review.frequencyMonths} months`,
    `Last Review: ${review.lastReviewDate}`,
    `Next Review: ${review.nextReviewDate}`,
    `Status: ${review.status}`,
    ``,
    `Regulatory Basis: FDL No.10/2025, FATF Rec 10`,
    ``,
    `---`,
    `Auto-created by Hawkeye Sterling V2 Periodic Review`,
  ].join('\n');
  return {
    name: `[REVIEW] ${review.reviewType} — ${review.customerName}`,
    notes: maybeAppendCitation(baseNotes, {
      // Periodic review is a flag-grade task by default.
      verdict: 'flag',
      caseId: review.id,
    }),
    projects: [projectId],
    due_on: review.nextReviewDate.slice(0, 10),
    ...(Object.keys(custom_fields).length > 0 ? { custom_fields } : {}),
  };
}

// ─── Public Sync Functions ───────────────────────────────────────────────────

export async function syncCaseToAsana(
  caseObj: ComplianceCase
): Promise<{ ok: boolean; gid?: string; error?: string }> {
  if (!isAsanaConfigured()) {
    return { ok: false, error: 'Asana not configured' };
  }

  const customer = findCustomerByCase(caseObj);
  const projectId = getComplianceProject(customer);
  const payload = buildCaseTaskPayload(caseObj, projectId);

  const result = await createAsanaTask(payload);
  if (result.ok && result.gid) {
    addTaskLink(caseObj.id, 'case', result.gid, projectId, customer?.id);
  } else if (!result.ok) {
    enqueueRetry(payload, 'case-sync', result.error ?? 'Unknown', caseObj.id);
  }
  return result;
}

export async function syncAlertToAsana(
  alertItem: Alert,
  customers: CustomerProfile[]
): Promise<{ ok: boolean; gid?: string; error?: string }> {
  if (!isAsanaConfigured()) {
    return { ok: false, error: 'Asana not configured' };
  }

  const customer = customers.find((c) => c.id === alertItem.subjectId);
  const registryEntry = COMPANY_REGISTRY.find((c) => c.id === alertItem.subjectId);
  const projectId = getComplianceProject(registryEntry);
  const entityName = customer?.legalName ?? alertItem.subjectId;
  const payload = buildAlertTaskPayload(alertItem, entityName, projectId);

  const result = await createAsanaTask(payload);
  if (result.ok && result.gid) {
    addTaskLink(alertItem.id, 'alert', result.gid, projectId, registryEntry?.id);
  } else if (!result.ok) {
    enqueueRetry(payload, 'alert-sync', result.error ?? 'Unknown');
  }
  return result;
}

export async function syncApprovalToAsana(
  approval: ApprovalRequest,
  caseObj: ComplianceCase
): Promise<{ ok: boolean; gid?: string; error?: string }> {
  if (!isAsanaConfigured()) {
    return { ok: false, error: 'Asana not configured' };
  }

  const customer = findCustomerByCase(caseObj);
  const projectId = getWorkflowProject(customer);
  const payload = buildApprovalTaskPayload(approval, caseObj, projectId);

  const result = await createAsanaTask(payload);
  if (result.ok && result.gid) {
    addTaskLink(approval.id, 'approval', result.gid, projectId, customer?.id);
  } else if (!result.ok) {
    enqueueRetry(payload, 'approval-sync', result.error ?? 'Unknown', approval.id);
  }
  return result;
}

export async function syncReviewToAsana(
  review: PeriodicReviewSchedule
): Promise<{ ok: boolean; gid?: string; error?: string }> {
  if (!isAsanaConfigured()) {
    return { ok: false, error: 'Asana not configured' };
  }

  const registryEntry = COMPANY_REGISTRY.find((c) => c.id === review.customerId);
  const projectId = getWorkflowProject(registryEntry);
  const payload = buildReviewTaskPayload(review, projectId);

  const result = await createAsanaTask(payload);
  if (result.ok && result.gid) {
    addTaskLink(review.id, 'review', result.gid, projectId, registryEntry?.id);
  } else if (!result.ok) {
    enqueueRetry(payload, 'review-sync', result.error ?? 'Unknown', review.id);
  }
  return result;
}

export async function markAsanaTaskComplete(
  taskGid: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isAsanaConfigured()) {
    return { ok: false, error: 'Asana not configured' };
  }
  return updateAsanaTask(taskGid, { completed: true });
}

export async function updateCaseTaskStatus(
  taskGid: string,
  caseObj: ComplianceCase
): Promise<{ ok: boolean; error?: string }> {
  if (!isAsanaConfigured()) {
    return { ok: false, error: 'Asana not configured' };
  }

  const name = `[${caseObj.riskLevel.toUpperCase()}] ${caseObj.caseType} — ${caseObj.entityId} [${caseObj.status}]`;
  return updateAsanaTask(taskGid, { name });
}
