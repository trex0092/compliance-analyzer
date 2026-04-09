/**
 * Case Management MCP Tools
 *
 * Exposes case lifecycle, approval workflow, and CDD renewal
 * as callable MCP tools.
 *
 * Regulatory basis: FDL No.10/2025 Art.20-21 (CO duties),
 * Cabinet Res 134/2025 Art.7-10 (CDD tiers)
 */

import type { ToolResult } from '../mcp-server';
import type {
  ComplianceCase,
  CaseType,
  CaseStatus,
  AuditAction,
} from '../../domain/cases';
import type { CustomerProfile } from '../../domain/customers';
import type { ApprovalRequest } from '../../domain/approvals';
import type { RenewalScanResult } from '../../services/cddRenewalEngine';

import {
  requiresApproval,
  createApprovalRequest,
  canProceedWithoutApproval,
  type ApprovalGate,
} from '../../domain/approvalWorkflow';
import { scanForRenewals, type RenewalTask } from '../../services/cddRenewalEngine';
import { appendToChain, type ChainedAuditEvent } from '../../utils/auditChain';

// ---------------------------------------------------------------------------
// Tool: create_case
// ---------------------------------------------------------------------------

export interface CreateCaseInput {
  entityId: string;
  caseType: CaseType;
  sourceModule: ComplianceCase['sourceModule'];
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  redFlags: string[];
  findings: string[];
  narrative: string;
  recommendation: ComplianceCase['recommendation'];
  assignedTo?: string;
  linkedCustomerId?: string;
}

export async function createCase(
  input: CreateCaseInput,
  auditChain: ChainedAuditEvent[],
  analyst: string,
): Promise<ToolResult<ComplianceCase>> {
  const now = new Date().toISOString();
  const caseObj: ComplianceCase = {
    id: `CASE-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    entityId: input.entityId,
    caseType: input.caseType,
    status: 'open',
    createdAt: now,
    updatedAt: now,
    createdBy: analyst,
    assignedTo: input.assignedTo,
    sourceModule: input.sourceModule,
    riskScore: input.riskScore,
    riskLevel: input.riskLevel,
    redFlags: input.redFlags,
    findings: input.findings,
    narrative: input.narrative,
    recommendation: input.recommendation,
    linkedCustomerId: input.linkedCustomerId,
    auditLog: [
      {
        id: crypto.randomUUID(),
        at: now,
        by: analyst,
        action: 'created' as AuditAction,
        note: `Case created — type: ${input.caseType}, risk: ${input.riskLevel}`,
      },
    ],
  };

  await appendToChain(auditChain, {
    id: crypto.randomUUID(),
    at: now,
    by: analyst,
    action: 'created',
    note: `Case ${caseObj.id} created — ${input.caseType}, risk: ${input.riskLevel}`,
  });

  return { ok: true, data: caseObj };
}

// ---------------------------------------------------------------------------
// Tool: update_case_status
// ---------------------------------------------------------------------------

export interface UpdateCaseStatusInput {
  caseObj: ComplianceCase;
  newStatus: CaseStatus;
  note?: string;
}

export async function updateCaseStatus(
  input: UpdateCaseStatusInput,
  auditChain: ChainedAuditEvent[],
  analyst: string,
): Promise<ToolResult<ComplianceCase>> {
  const now = new Date().toISOString();
  const updated: ComplianceCase = {
    ...input.caseObj,
    status: input.newStatus,
    updatedAt: now,
    auditLog: [
      ...input.caseObj.auditLog,
      {
        id: crypto.randomUUID(),
        at: now,
        by: analyst,
        action: 'status-changed' as AuditAction,
        note: input.note ?? `Status changed to ${input.newStatus}`,
        before: input.caseObj.status,
        after: input.newStatus,
      },
    ],
  };

  await appendToChain(auditChain, {
    id: crypto.randomUUID(),
    at: now,
    by: analyst,
    action: 'status-changed',
    note: `Case ${updated.id}: ${input.caseObj.status} → ${input.newStatus}`,
  });

  return { ok: true, data: updated };
}

// ---------------------------------------------------------------------------
// Tool: check_approvals
// ---------------------------------------------------------------------------

export function checkApprovals(
  caseObj: ComplianceCase,
  existingApprovals: ApprovalRequest[],
): ToolResult<{
  requiredGates: ApprovalGate[];
  canProceed: boolean;
  pendingGates: ApprovalGate[];
  rejectedGates: ApprovalGate[];
}> {
  const gates = requiresApproval(caseObj);
  const result = canProceedWithoutApproval(gates, existingApprovals);

  return {
    ok: true,
    data: {
      requiredGates: gates,
      ...result,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: request_approval
// ---------------------------------------------------------------------------

export interface RequestApprovalInput {
  caseId: string;
  gate: ApprovalGate;
}

export async function requestApproval(
  input: RequestApprovalInput,
  auditChain: ChainedAuditEvent[],
  analyst: string,
): Promise<ToolResult<ApprovalRequest>> {
  const approval = createApprovalRequest(input.caseId, input.gate, analyst);

  await appendToChain(auditChain, {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    by: analyst,
    action: 'approval-requested',
    note: `Approval requested — gate: ${input.gate}, case: ${input.caseId}`,
  });

  return { ok: true, data: approval };
}

// ---------------------------------------------------------------------------
// Tool: scan_cdd_renewals
// ---------------------------------------------------------------------------

export async function scanCDDRenewals(
  customers: CustomerProfile[],
  existingTasks?: RenewalTask[],
  auditChain?: ChainedAuditEvent[],
  analyst?: string,
): Promise<ToolResult<RenewalScanResult>> {
  const result = scanForRenewals(customers, existingTasks);

  if (auditChain && analyst) {
    await appendToChain(auditChain, {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      by: analyst,
      action: 'created',
      note: `CDD renewal scan — ${result.renewalsDue.length} due, ${result.renewalsOverdue.length} overdue, ${result.upcomingIn30Days.length} upcoming`,
    });
  }

  return { ok: true, data: result };
}

// ---------------------------------------------------------------------------
// Schema exports for MCP registration
// ---------------------------------------------------------------------------

export const CASE_TOOL_SCHEMAS = [
  {
    name: 'create_case',
    description:
      'Create a new compliance case with full audit trail. Supports: onboarding, transaction-monitoring, screening-hit, sanctions-hit, periodic-review, incident, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'string' },
        caseType: {
          type: 'string',
          enum: [
            'onboarding', 'transaction-monitoring', 'screening-hit', 'sanctions-hit',
            'periodic-review', 'sourcing-review', 'incident', 'regulatory-breach',
            'pf-screening', 'adverse-media', 'third-party-payment', 'customer-exit',
          ],
        },
        sourceModule: { type: 'string' },
        riskScore: { type: 'number' },
        riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        redFlags: { type: 'array', items: { type: 'string' } },
        findings: { type: 'array', items: { type: 'string' } },
        narrative: { type: 'string' },
        recommendation: { type: 'string' },
        assignedTo: { type: 'string' },
        linkedCustomerId: { type: 'string' },
      },
      required: ['entityId', 'caseType', 'sourceModule', 'riskScore', 'riskLevel', 'redFlags', 'findings', 'narrative', 'recommendation'],
    },
  },
  {
    name: 'update_case_status',
    description:
      'Update case status with audit logging. Supports: open → under-review → escalated → approved/reported/closed.',
    inputSchema: {
      type: 'object',
      properties: {
        caseObj: { type: 'object', description: 'Full ComplianceCase object' },
        newStatus: { type: 'string', enum: ['open', 'under-review', 'pending-info', 'escalated', 'approved', 'reported', 'closed', 'rejected'] },
        note: { type: 'string' },
      },
      required: ['caseObj', 'newStatus'],
    },
  },
  {
    name: 'check_approvals',
    description:
      'Check which approval gates are required for a case and whether they are satisfied. Implements four-eyes principle for critical gates.',
    inputSchema: {
      type: 'object',
      properties: {
        caseObj: { type: 'object', description: 'Full ComplianceCase object' },
        existingApprovals: { type: 'array', description: 'Array of ApprovalRequest objects' },
      },
      required: ['caseObj', 'existingApprovals'],
    },
  },
  {
    name: 'request_approval',
    description:
      'Create an approval request for a specific gate (PEP onboarding, STR approval, asset freeze, etc.). Regulatory: FDL Art.14, Cabinet Res 134/2025.',
    inputSchema: {
      type: 'object',
      properties: {
        caseId: { type: 'string' },
        gate: {
          type: 'string',
          enum: [
            'pep-onboarding', 'high-risk-onboarding', 'edd-continuation', 'str-approval',
            'sar-approval', 'ctr-approval', 'policy-exception', 'asset-freeze',
            'customer-exit', 'pf-escalation',
          ],
        },
      },
      required: ['caseId', 'gate'],
    },
  },
  {
    name: 'scan_cdd_renewals',
    description:
      'Scan customers for upcoming/overdue CDD renewals. Review frequency: high=3mo, medium=6mo, low=12mo. Regulatory: Cabinet Res 134/2025 Art.7-10.',
    inputSchema: {
      type: 'object',
      properties: {
        customers: { type: 'array', description: 'Array of CustomerProfile objects' },
        existingTasks: { type: 'array', description: 'Optional existing RenewalTask array' },
      },
      required: ['customers'],
    },
  },
] as const;
