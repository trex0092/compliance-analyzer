/**
 * Four-Eyes Principle Enforcer
 *
 * Brain-level dual-approval enforcement for high-risk compliance decisions.
 * Prevents single-person approval of freeze, STR filing, EDD escalation
 * and sanctions confirmation decisions.
 *
 * Regulatory: FDL No.10/2025 Art.20-21 (CO duties), Cabinet Res 134/2025
 *             Art.14 (EDD senior management approval), Cabinet Res 74/2020
 *             Art.4-7 (freeze confirmation), FATF Rec 26 (internal controls),
 *             UAE MoE Circular 08/AML/2021 (governance).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type DecisionType =
  | 'sanctions_freeze'       // Cabinet Res 74/2020 Art.4 — requires CO + Senior Mgmt
  | 'str_filing'             // FDL Art.26 — requires CO + MLRO
  | 'edd_escalation'         // Cabinet Res 134/2025 Art.14 — requires CO + Senior Mgmt
  | 'pep_approval'           // Cabinet Res 134/2025 Art.14 — board-level
  | 'account_termination'    // internal — requires CO + Legal
  | 'high_value_transaction' // AED 55K+ — requires CO + branch head
  | 'cdd_override'           // override of automated CDD level — requires CO + Supervisor
  | 'false_positive_dismiss' // dismiss a sanctions match — requires CO + Senior Analyst;

export type ApproverRole =
  | 'compliance_officer'
  | 'mlro'
  | 'senior_management'
  | 'board'
  | 'legal'
  | 'senior_analyst'
  | 'branch_head'
  | 'supervisor';

export interface ApprovalRequirement {
  decisionType: DecisionType;
  minApprovers: number;
  requiredRoles: ApproverRole[][];    // each inner array = OR (any of), outer = AND (all required)
  timeoutHours: number;              // decision expires if not completed in time
  regulatoryRef: string;
}

export const APPROVAL_REQUIREMENTS: ApprovalRequirement[] = [
  {
    decisionType: 'sanctions_freeze',
    minApprovers: 2,
    requiredRoles: [['compliance_officer', 'mlro'], ['senior_management', 'board']],
    timeoutHours: 24,  // Cabinet Res 74/2020 Art.4 — freeze within 24h
    regulatoryRef: 'Cabinet Res 74/2020 Art.4-7',
  },
  {
    decisionType: 'str_filing',
    minApprovers: 2,
    requiredRoles: [['compliance_officer', 'mlro'], ['mlro', 'senior_management']],
    timeoutHours: 240,  // 10 business days per FDL Art.26
    regulatoryRef: 'FDL No.10/2025 Art.26-27',
  },
  {
    decisionType: 'edd_escalation',
    minApprovers: 2,
    requiredRoles: [['compliance_officer', 'mlro'], ['senior_management']],
    timeoutHours: 72,
    regulatoryRef: 'Cabinet Res 134/2025 Art.14',
  },
  {
    decisionType: 'pep_approval',
    minApprovers: 2,
    requiredRoles: [['compliance_officer', 'mlro'], ['board', 'senior_management']],
    timeoutHours: 72,
    regulatoryRef: 'Cabinet Res 134/2025 Art.14',
  },
  {
    decisionType: 'account_termination',
    minApprovers: 2,
    requiredRoles: [['compliance_officer', 'mlro'], ['legal', 'senior_management']],
    timeoutHours: 48,
    regulatoryRef: 'FDL No.10/2025 Art.20',
  },
  {
    decisionType: 'high_value_transaction',
    minApprovers: 2,
    requiredRoles: [['compliance_officer', 'supervisor'], ['branch_head', 'senior_management']],
    timeoutHours: 8,
    regulatoryRef: 'MoE Circular 08/AML/2021; AED 55K CTR threshold',
  },
  {
    decisionType: 'cdd_override',
    minApprovers: 2,
    requiredRoles: [['compliance_officer'], ['supervisor', 'senior_management']],
    timeoutHours: 24,
    regulatoryRef: 'Cabinet Res 134/2025 Art.7-10',
  },
  {
    decisionType: 'false_positive_dismiss',
    minApprovers: 2,
    requiredRoles: [['compliance_officer', 'mlro'], ['senior_analyst', 'mlro']],
    timeoutHours: 48,
    regulatoryRef: 'FDL No.10/2025 Art.12; FATF Rec 26',
  },
];

export interface ApprovalSubmission {
  decisionId: string;
  decisionType: DecisionType;
  approvals: Approval[];
  requestedAt: string;
  expiresAt: string;
}

export interface Approval {
  approverId: string;
  approverRole: ApproverRole;
  approvedAt: string;
  comments?: string;
}

export type FourEyesStatus =
  | 'pending'          // insufficient approvals
  | 'approved'         // all requirements met
  | 'expired'          // timeout reached without approval
  | 'rejected'         // one approver actively rejected
  | 'conflict'         // same approver attempted twice
  | 'role_mismatch';   // approvals don't satisfy role requirements

export interface FourEyesResult {
  decisionId: string;
  decisionType: DecisionType;
  status: FourEyesStatus;
  meetsRequirements: boolean;
  approvedRoles: ApproverRole[];
  missingRoles: string[];          // human-readable description
  approvalCount: number;
  requiredCount: number;
  isExpired: boolean;
  hoursRemaining: number;
  violations: string[];
  auditTrail: string[];
  regulatoryRef: string;
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

export function enforceFourEyes(submission: ApprovalSubmission): FourEyesResult {
  const req = APPROVAL_REQUIREMENTS.find(r => r.decisionType === submission.decisionType);
  if (!req) {
    return {
      decisionId: submission.decisionId,
      decisionType: submission.decisionType,
      status: 'rejected',
      meetsRequirements: false,
      approvedRoles: [],
      missingRoles: [`Unknown decision type: ${submission.decisionType}`],
      approvalCount: 0,
      requiredCount: 2,
      isExpired: false,
      hoursRemaining: 0,
      violations: [`No approval requirement found for decision type ${submission.decisionType}`],
      auditTrail: [],
      regulatoryRef: 'FDL No.10/2025 Art.20',
    };
  }

  const violations: string[] = [];
  const auditTrail: string[] = [];
  const now = new Date();
  const expiresAt = new Date(submission.expiresAt);
  const isExpired = now > expiresAt;
  const hoursRemaining = Math.max(0, (expiresAt.getTime() - now.getTime()) / 3_600_000);

  // Anti-pattern: same approver cannot approve twice
  const approverIds = submission.approvals.map(a => a.approverId);
  const uniqueApprovers = new Set(approverIds);
  if (uniqueApprovers.size < submission.approvals.length) {
    violations.push('CONFLICT: Same person approved more than once — four-eyes violated');
  }

  // Check each role group is satisfied
  const approvedRoles = submission.approvals.map(a => a.approverRole);
  const missingRoles: string[] = [];

  let rolesOk = true;
  for (const roleGroup of req.requiredRoles) {
    const satisfied = roleGroup.some(role => approvedRoles.includes(role));
    if (!satisfied) {
      rolesOk = false;
      missingRoles.push(`Need one of: ${roleGroup.join(' / ')}`);
    }
  }

  // Check minimum approver count
  const countOk = uniqueApprovers.size >= req.minApprovers;
  if (!countOk) {
    violations.push(`Only ${uniqueApprovers.size} unique approver(s); minimum ${req.minApprovers} required`);
  }

  if (!rolesOk) violations.push(`Role requirements not met: ${missingRoles.join('; ')}`);
  if (isExpired) violations.push(`Decision expired at ${submission.expiresAt} — re-initiate workflow`);

  const meetsRequirements = violations.length === 0 && rolesOk && countOk && !isExpired;

  let status: FourEyesStatus = 'pending';
  if (violations.some(v => v.includes('CONFLICT'))) status = 'conflict';
  else if (isExpired) status = 'expired';
  else if (!rolesOk) status = 'role_mismatch';
  else if (meetsRequirements) status = 'approved';

  // Audit trail entries
  for (const approval of submission.approvals) {
    auditTrail.push(`[${approval.approvedAt}] Approved by ${approval.approverId} (${approval.approverRole})${approval.comments ? ': ' + approval.comments : ''}`);
  }
  auditTrail.push(`[${now.toISOString()}] Four-eyes check result: ${status.toUpperCase()}`);

  return {
    decisionId: submission.decisionId,
    decisionType: submission.decisionType,
    status,
    meetsRequirements,
    approvedRoles,
    missingRoles,
    approvalCount: uniqueApprovers.size,
    requiredCount: req.minApprovers,
    isExpired,
    hoursRemaining,
    violations,
    auditTrail,
    regulatoryRef: req.regulatoryRef,
  };
}

/**
 * Quick check: does this decision type require four-eyes approval?
 * Used by the brain to gate automated decisions.
 */
export function requiresFourEyes(decisionType: DecisionType): boolean {
  return APPROVAL_REQUIREMENTS.some(r => r.decisionType === decisionType);
}

/**
 * Returns the timeout (in hours) for the given decision type.
 * Critical for brain-level escalation timers (e.g. sanctions freeze = 24h).
 */
export function getFourEyesTimeout(decisionType: DecisionType): number {
  return APPROVAL_REQUIREMENTS.find(r => r.decisionType === decisionType)?.timeoutHours ?? 48;
}
