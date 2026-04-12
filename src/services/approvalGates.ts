/**
 * Enhanced Approval Gates System
 *
 * Extends fourEyesEnforcer.ts with patterns from NousResearch/hermes-agent
 * approval.py and multica's event-driven architecture:
 *
 * - Timeout escalation chains (CO -> MLRO -> Senior Mgmt -> Board)
 * - Delegation support (approver delegates to qualified substitute)
 * - Emergency override with mandatory justification + full audit trail
 * - Parallel approval tracking across multiple concurrent decisions
 * - SLA monitoring with approaching-deadline alerts
 * - Integration with weaponized consensus (auto-gates on screening verdicts)
 *
 * Regulatory refs:
 * - FDL No.10/2025 Art.20-21 (CO duties), Art.26-27 (STR filing)
 * - Cabinet Res 74/2020 Art.4-7 (freeze within 24h — hardest deadline)
 * - Cabinet Res 134/2025 Art.14 (PEP/EDD Senior Management approval)
 * - FATF Rec 26 (internal controls, four-eyes)
 *
 * Patterns adopted:
 * - hermes-agent: approval.py (human-in-the-loop gates)
 * - multica: daemon event architecture (SLA monitoring)
 * - claude-code-best-practice: subagent isolation (read-only audit)
 */

import type {
  DecisionType,
  ApproverRole,
  ApprovalRequirement,
  FourEyesResult,
} from './fourEyesEnforcer';
import { APPROVAL_REQUIREMENTS, enforceFourEyes } from './fourEyesEnforcer';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DelegationRecord {
  originalApprover: string;
  originalRole: ApproverRole;
  delegateTo: string;
  delegateRole: ApproverRole;
  reason: string;
  delegatedAt: string;
  expiresAt: string;
  /** Delegation is valid only if delegate has equivalent or higher authority */
  valid: boolean;
  validationReason: string;
}

export interface EmergencyOverride {
  overrideId: string;
  decisionId: string;
  decisionType: DecisionType;
  overriddenBy: string;
  overriderRole: ApproverRole;
  justification: string;
  /** Emergency overrides MUST cite a regulatory basis */
  regulatoryBasis: string;
  /** Risk accepted by overriding the normal flow */
  riskAcceptance: string;
  timestamp: string;
  /** Post-override review requirement */
  postReviewRequired: boolean;
  postReviewDeadlineHours: number;
  postReviewedBy?: string;
  postReviewedAt?: string;
}

export interface EscalationStep {
  level: number;
  from: string;
  to: ApproverRole;
  reason: string;
  escalatedAt: string;
  deadlineAt: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
}

export type GateStatus =
  | 'open'              // waiting for approvals
  | 'approved'          // all requirements met
  | 'rejected'          // explicitly rejected
  | 'expired'           // timeout without approval
  | 'escalated'         // pushed up the chain
  | 'overridden'        // emergency override used
  | 'delegated';        // approval authority delegated

export interface ApprovalSLA {
  decisionType: DecisionType;
  warningThresholdPercent: number;   // alert when this % of time has elapsed
  criticalThresholdPercent: number;  // critical alert
  totalHours: number;
}

export interface ApprovalGate {
  gateId: string;
  decisionId: string;
  decisionType: DecisionType;
  entityId: string;
  entityName: string;

  /** Current status */
  status: GateStatus;

  /** Standard four-eyes result */
  fourEyesResult?: FourEyesResult;

  /** Escalation history */
  escalationChain: EscalationStep[];
  currentEscalationLevel: number;

  /** Delegation records */
  delegations: DelegationRecord[];

  /** Emergency override (if used) */
  emergencyOverride?: EmergencyOverride;

  /** SLA tracking */
  createdAt: string;
  deadlineAt: string;
  slaStatus: 'on-track' | 'warning' | 'critical' | 'breached';
  hoursRemaining: number;
  hoursElapsed: number;

  /** Full audit trail — immutable append-only */
  auditTrail: GateAuditEntry[];

  /** Regulatory references */
  regulatoryRefs: string[];

  /** Linked consensus ID (from weaponized consensus) */
  linkedConsensusId?: string;
}

export interface GateAuditEntry {
  timestamp: string;
  actor: string;
  actorRole: string;
  action: string;
  details: string;
  regulatoryRef?: string;
}

export interface ApprovalRequest {
  approverId: string;
  approverRole: ApproverRole;
  comments?: string;
}

// ─── Role Authority Hierarchy ───────────────────────────────────────────────

/** Higher number = higher authority. Used for delegation validation. */
const ROLE_AUTHORITY: Record<ApproverRole, number> = {
  supervisor: 1,
  senior_analyst: 2,
  branch_head: 3,
  compliance_officer: 4,
  legal: 4,
  mlro: 5,
  senior_management: 6,
  board: 7,
};

// ─── SLA Configuration ──────────────────────────────────────────────────────

const SLA_CONFIGS: ApprovalSLA[] = [
  { decisionType: 'sanctions_freeze', warningThresholdPercent: 50, criticalThresholdPercent: 75, totalHours: 24 },
  { decisionType: 'str_filing', warningThresholdPercent: 60, criticalThresholdPercent: 80, totalHours: 240 },
  { decisionType: 'edd_escalation', warningThresholdPercent: 50, criticalThresholdPercent: 75, totalHours: 72 },
  { decisionType: 'pep_approval', warningThresholdPercent: 50, criticalThresholdPercent: 75, totalHours: 72 },
  { decisionType: 'account_termination', warningThresholdPercent: 50, criticalThresholdPercent: 75, totalHours: 48 },
  { decisionType: 'high_value_transaction', warningThresholdPercent: 50, criticalThresholdPercent: 75, totalHours: 8 },
  { decisionType: 'cdd_override', warningThresholdPercent: 50, criticalThresholdPercent: 75, totalHours: 24 },
  { decisionType: 'false_positive_dismiss', warningThresholdPercent: 50, criticalThresholdPercent: 75, totalHours: 48 },
];

/** Escalation chain: who to escalate to when an approval times out at each level */
const TIMEOUT_ESCALATION: ApproverRole[] = [
  'compliance_officer',
  'mlro',
  'senior_management',
  'board',
];

// ─── Core Engine ────────────────────────────────────────────────────────────

/**
 * Create a new approval gate for a compliance decision.
 * This is the entry point — call when a decision requires four-eyes approval.
 */
export function createApprovalGate(
  decisionId: string,
  decisionType: DecisionType,
  entityId: string,
  entityName: string,
  linkedConsensusId?: string,
): ApprovalGate {
  const now = new Date();
  const req = APPROVAL_REQUIREMENTS.find(r => r.decisionType === decisionType);
  const totalHours = req?.timeoutHours ?? 48;
  const deadlineAt = new Date(now.getTime() + totalHours * 3_600_000);

  const gate: ApprovalGate = {
    gateId: `gate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    decisionId,
    decisionType,
    entityId,
    entityName,
    status: 'open',
    escalationChain: [],
    currentEscalationLevel: 0,
    delegations: [],
    createdAt: now.toISOString(),
    deadlineAt: deadlineAt.toISOString(),
    slaStatus: 'on-track',
    hoursRemaining: totalHours,
    hoursElapsed: 0,
    auditTrail: [{
      timestamp: now.toISOString(),
      actor: 'system',
      actorRole: 'system',
      action: 'gate_created',
      details: `Approval gate opened for ${decisionType} on entity ${entityName}`,
      regulatoryRef: req?.regulatoryRef,
    }],
    regulatoryRefs: req ? [req.regulatoryRef] : ['FDL No.10/2025 Art.20'],
    linkedConsensusId,
  };

  return gate;
}

/**
 * Submit an approval to an open gate.
 * Returns the updated gate with four-eyes validation applied.
 */
export function submitApproval(
  gate: ApprovalGate,
  approval: ApprovalRequest,
): ApprovalGate {
  const now = new Date();
  const updated = { ...gate, auditTrail: [...gate.auditTrail], escalationChain: [...gate.escalationChain], delegations: [...gate.delegations] };

  // Check if gate is still open
  if (gate.status !== 'open' && gate.status !== 'escalated' && gate.status !== 'delegated') {
    updated.auditTrail.push({
      timestamp: now.toISOString(),
      actor: approval.approverId,
      actorRole: approval.approverRole,
      action: 'approval_rejected',
      details: `Cannot approve: gate status is ${gate.status}`,
    });
    return updated;
  }

  // Record the approval attempt
  updated.auditTrail.push({
    timestamp: now.toISOString(),
    actor: approval.approverId,
    actorRole: approval.approverRole,
    action: 'approval_submitted',
    details: `Approval submitted by ${approval.approverId} (${approval.approverRole})${approval.comments ? ': ' + approval.comments : ''}`,
  });

  // Collect all approvals from audit trail
  const allApprovals = updated.auditTrail
    .filter(e => e.action === 'approval_submitted')
    .map(e => ({
      approverId: e.actor,
      approverRole: e.actorRole as ApproverRole,
      approvedAt: e.timestamp,
      comments: e.details,
    }));

  // Run four-eyes enforcement
  const req = APPROVAL_REQUIREMENTS.find(r => r.decisionType === gate.decisionType);
  if (req) {
    const expiresAt = gate.deadlineAt;
    const fourEyesResult = enforceFourEyes({
      decisionId: gate.decisionId,
      decisionType: gate.decisionType,
      approvals: allApprovals,
      requestedAt: gate.createdAt,
      expiresAt,
    });

    updated.fourEyesResult = fourEyesResult;

    if (fourEyesResult.meetsRequirements) {
      updated.status = 'approved';
      updated.auditTrail.push({
        timestamp: now.toISOString(),
        actor: 'system',
        actorRole: 'system',
        action: 'gate_approved',
        details: `Four-eyes requirements met. ${allApprovals.length} approvals from: ${allApprovals.map(a => a.approverRole).join(', ')}`,
        regulatoryRef: req.regulatoryRef,
      });
    }
  }

  // Update SLA
  return updateSLA(updated);
}

/**
 * Delegate approval authority to a substitute.
 * Delegation is valid only if the delegate has equal or higher authority.
 */
export function delegateApproval(
  gate: ApprovalGate,
  delegation: Omit<DelegationRecord, 'valid' | 'validationReason' | 'delegatedAt' | 'expiresAt'>,
  expiresInHours: number = 24,
): ApprovalGate {
  const now = new Date();
  const updated = { ...gate, auditTrail: [...gate.auditTrail], delegations: [...gate.delegations] };

  const originalAuthority = ROLE_AUTHORITY[delegation.originalRole] ?? 0;
  const delegateAuthority = ROLE_AUTHORITY[delegation.delegateRole] ?? 0;
  const valid = delegateAuthority >= originalAuthority;

  const record: DelegationRecord = {
    ...delegation,
    delegatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + expiresInHours * 3_600_000).toISOString(),
    valid,
    validationReason: valid
      ? `${delegation.delegateRole} (authority ${delegateAuthority}) >= ${delegation.originalRole} (authority ${originalAuthority})`
      : `INVALID: ${delegation.delegateRole} (authority ${delegateAuthority}) < ${delegation.originalRole} (authority ${originalAuthority})`,
  };

  updated.delegations.push(record);
  updated.auditTrail.push({
    timestamp: now.toISOString(),
    actor: delegation.originalApprover,
    actorRole: delegation.originalRole,
    action: valid ? 'delegation_approved' : 'delegation_rejected',
    details: `Delegation from ${delegation.originalApprover} (${delegation.originalRole}) to ${delegation.delegateTo} (${delegation.delegateRole}): ${record.validationReason}`,
  });

  if (valid) updated.status = 'delegated';

  return updated;
}

/**
 * Emergency override — bypasses normal approval flow.
 * MUST have justification + regulatory basis. Triggers mandatory post-review.
 *
 * Only permitted for: mlro, senior_management, board
 * (Cabinet Res 134/2025 Art.14, FDL Art.20-21)
 */
export function emergencyOverride(
  gate: ApprovalGate,
  override: Omit<EmergencyOverride, 'overrideId' | 'timestamp' | 'postReviewRequired' | 'postReviewDeadlineHours'>,
): ApprovalGate {
  const now = new Date();
  const updated = { ...gate, auditTrail: [...gate.auditTrail] };

  // Only senior roles can emergency override
  const overriderAuthority = ROLE_AUTHORITY[override.overriderRole] ?? 0;
  if (overriderAuthority < ROLE_AUTHORITY.mlro) {
    updated.auditTrail.push({
      timestamp: now.toISOString(),
      actor: override.overriddenBy,
      actorRole: override.overriderRole,
      action: 'emergency_override_rejected',
      details: `${override.overriderRole} lacks authority for emergency override (minimum: MLRO)`,
    });
    return updated;
  }

  // Justification is mandatory
  if (!override.justification || override.justification.length < 20) {
    updated.auditTrail.push({
      timestamp: now.toISOString(),
      actor: override.overriddenBy,
      actorRole: override.overriderRole,
      action: 'emergency_override_rejected',
      details: 'Emergency override requires justification (minimum 20 characters)',
    });
    return updated;
  }

  const overrideRecord: EmergencyOverride = {
    ...override,
    overrideId: `eo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: now.toISOString(),
    postReviewRequired: true,
    postReviewDeadlineHours: gate.decisionType === 'sanctions_freeze' ? 24 : 72,
  };

  updated.emergencyOverride = overrideRecord;
  updated.status = 'overridden';
  updated.auditTrail.push({
    timestamp: now.toISOString(),
    actor: override.overriddenBy,
    actorRole: override.overriderRole,
    action: 'emergency_override_applied',
    details: `Emergency override by ${override.overriddenBy} (${override.overriderRole}). Justification: ${override.justification}. Regulatory basis: ${override.regulatoryBasis}. Risk acceptance: ${override.riskAcceptance}. POST-REVIEW REQUIRED within ${overrideRecord.postReviewDeadlineHours}h.`,
    regulatoryRef: override.regulatoryBasis,
  });

  updated.regulatoryRefs = [...updated.regulatoryRefs, override.regulatoryBasis];

  return updated;
}

/**
 * Escalate an approval gate to the next level in the chain.
 * Called automatically when SLA approaches breach, or manually by an approver.
 */
export function escalateGate(
  gate: ApprovalGate,
  escalatedBy: string,
  reason: string,
): ApprovalGate {
  const now = new Date();
  const updated = { ...gate, auditTrail: [...gate.auditTrail], escalationChain: [...gate.escalationChain] };
  const nextLevel = gate.currentEscalationLevel + 1;

  if (nextLevel > TIMEOUT_ESCALATION.length) {
    updated.auditTrail.push({
      timestamp: now.toISOString(),
      actor: escalatedBy,
      actorRole: 'system',
      action: 'escalation_exhausted',
      details: `All escalation levels exhausted (level ${nextLevel}). Board must act.`,
    });
    return updated;
  }

  const targetRole = TIMEOUT_ESCALATION[nextLevel - 1];
  const slaConfig = SLA_CONFIGS.find(s => s.decisionType === gate.decisionType);
  const deadlineHours = slaConfig ? Math.max(1, slaConfig.totalHours * 0.25) : 12;

  const step: EscalationStep = {
    level: nextLevel,
    from: escalatedBy,
    to: targetRole,
    reason,
    escalatedAt: now.toISOString(),
    deadlineAt: new Date(now.getTime() + deadlineHours * 3_600_000).toISOString(),
    acknowledged: false,
  };

  updated.escalationChain.push(step);
  updated.currentEscalationLevel = nextLevel;
  updated.status = 'escalated';

  updated.auditTrail.push({
    timestamp: now.toISOString(),
    actor: escalatedBy,
    actorRole: 'system',
    action: 'escalated',
    details: `Escalated to level ${nextLevel} (${targetRole}). Reason: ${reason}. Deadline: ${step.deadlineAt}`,
  });

  return updated;
}

/**
 * Update SLA status based on elapsed time.
 * Call periodically or on every gate interaction.
 */
export function updateSLA(gate: ApprovalGate): ApprovalGate {
  const now = new Date();
  const created = new Date(gate.createdAt);
  const deadline = new Date(gate.deadlineAt);
  const totalMs = deadline.getTime() - created.getTime();
  const elapsedMs = now.getTime() - created.getTime();
  const remainingMs = deadline.getTime() - now.getTime();

  const updated = { ...gate };
  updated.hoursElapsed = Math.round((elapsedMs / 3_600_000) * 100) / 100;
  updated.hoursRemaining = Math.max(0, Math.round((remainingMs / 3_600_000) * 100) / 100);

  const percentElapsed = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 100;
  const slaConfig = SLA_CONFIGS.find(s => s.decisionType === gate.decisionType);

  if (remainingMs <= 0) {
    updated.slaStatus = 'breached';
  } else if (slaConfig && percentElapsed >= slaConfig.criticalThresholdPercent) {
    updated.slaStatus = 'critical';
  } else if (slaConfig && percentElapsed >= slaConfig.warningThresholdPercent) {
    updated.slaStatus = 'warning';
  } else {
    updated.slaStatus = 'on-track';
  }

  return updated;
}

/**
 * Get all gates that need attention (approaching SLA breach or escalation needed).
 * Used by the MLRO dashboard streaming service.
 */
export function getUrgentGates(gates: ApprovalGate[]): ApprovalGate[] {
  return gates
    .filter(g => g.status === 'open' || g.status === 'escalated' || g.status === 'delegated')
    .map(g => updateSLA(g))
    .filter(g => g.slaStatus === 'warning' || g.slaStatus === 'critical' || g.slaStatus === 'breached')
    .sort((a, b) => a.hoursRemaining - b.hoursRemaining);
}

/**
 * Generate audit report for a gate — used in regulatory filings and MoE inspections.
 */
export function generateGateAuditReport(gate: ApprovalGate): string {
  const lines: string[] = [];

  lines.push(`## Approval Gate Report: ${gate.gateId}`);
  lines.push(`**Decision:** ${gate.decisionType} | **Entity:** ${gate.entityName}`);
  lines.push(`**Status:** ${gate.status.toUpperCase()} | **SLA:** ${gate.slaStatus.toUpperCase()}`);
  lines.push(`**Created:** ${gate.createdAt} | **Deadline:** ${gate.deadlineAt}`);
  if (gate.linkedConsensusId) lines.push(`**Linked Consensus:** ${gate.linkedConsensusId}`);
  lines.push('');

  lines.push('### Audit Trail');
  for (const entry of gate.auditTrail) {
    lines.push(`- [${entry.timestamp}] **${entry.action}** by ${entry.actor} (${entry.actorRole}): ${entry.details}`);
    if (entry.regulatoryRef) lines.push(`  - Ref: ${entry.regulatoryRef}`);
  }
  lines.push('');

  if (gate.escalationChain.length > 0) {
    lines.push('### Escalation History');
    for (const step of gate.escalationChain) {
      lines.push(`- Level ${step.level}: ${step.from} -> ${step.to} at ${step.escalatedAt}. Reason: ${step.reason}. Acknowledged: ${step.acknowledged ? 'Yes' : 'No'}`);
    }
    lines.push('');
  }

  if (gate.delegations.length > 0) {
    lines.push('### Delegations');
    for (const d of gate.delegations) {
      lines.push(`- ${d.originalApprover} (${d.originalRole}) -> ${d.delegateTo} (${d.delegateRole}): ${d.valid ? 'VALID' : 'INVALID'} — ${d.validationReason}`);
    }
    lines.push('');
  }

  if (gate.emergencyOverride) {
    lines.push('### EMERGENCY OVERRIDE');
    lines.push(`- By: ${gate.emergencyOverride.overriddenBy} (${gate.emergencyOverride.overriderRole})`);
    lines.push(`- Justification: ${gate.emergencyOverride.justification}`);
    lines.push(`- Regulatory basis: ${gate.emergencyOverride.regulatoryBasis}`);
    lines.push(`- Risk acceptance: ${gate.emergencyOverride.riskAcceptance}`);
    lines.push(`- Post-review required: ${gate.emergencyOverride.postReviewRequired ? 'YES' : 'No'} (deadline: ${gate.emergencyOverride.postReviewDeadlineHours}h)`);
    if (gate.emergencyOverride.postReviewedBy) {
      lines.push(`- Post-reviewed by ${gate.emergencyOverride.postReviewedBy} at ${gate.emergencyOverride.postReviewedAt}`);
    }
    lines.push('');
  }

  lines.push('### Regulatory References');
  for (const ref of gate.regulatoryRefs) {
    lines.push(`- ${ref}`);
  }

  return lines.join('\n');
}
