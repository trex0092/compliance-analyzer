import type { ApprovalRequest } from './approvals';
import type { ComplianceCase } from './cases';
import { createId } from '../utils/id';
import { nowIso } from '../utils/dates';

export type ApprovalGate =
  | 'pep-onboarding'
  | 'high-risk-onboarding'
  | 'edd-continuation'
  | 'str-approval'
  | 'sar-approval'
  | 'ctr-approval'
  | 'policy-exception'
  | 'asset-freeze'
  | 'customer-exit'
  | 'pf-escalation';

/**
 * Determines which approval gates are required for a given case.
 * Based on FDL No.10/2025, Cabinet Resolution 134/2025, FATF Rec 10/22,
 * and MoE DPMS sector guidance.
 */
export function requiresApproval(caseObj: ComplianceCase): ApprovalGate[] {
  const gates: ApprovalGate[] = [];

  // PEP match → Senior Management approval per FDL Art.18, FATF Rec 12
  if (caseObj.redFlags.some((f) => f.includes('PEP') || f === 'RF016' || f === 'RF017')) {
    gates.push('pep-onboarding');
  }

  // High/Critical risk → 4-Eyes Principle per Cabinet Res 134/2025 Art.12-14
  if (caseObj.riskLevel === 'high' || caseObj.riskLevel === 'critical') {
    gates.push('high-risk-onboarding');
  }

  // EDD recommendation → Compliance Officer + MLRO per FDL Art.14-15
  if (caseObj.recommendation === 'edd') {
    gates.push('edd-continuation');
  }

  // STR recommendation → MLRO approval per FDL Art.26, MoE Guidance
  if (caseObj.recommendation === 'str-review') {
    gates.push('str-approval');
  }

  // SAR recommendation → MLRO approval
  if (caseObj.recommendation === 'sar-review') {
    gates.push('sar-approval');
  }

  // Freeze recommendation → MLRO + Senior Management per FDL Art.23, EOCN protocol
  if (caseObj.recommendation === 'freeze') {
    gates.push('str-approval');
    gates.push('asset-freeze');
  }

  // CTR filing → Compliance Officer approval per FDL Art.16, MoE Circular
  if (caseObj.recommendation === 'ctr-filing') {
    gates.push('ctr-approval');
  }

  // PF-related cases → escalation to MLRO and EOCN per Cabinet Res 156/2025
  if (
    caseObj.caseType === 'pf-screening' ||
    caseObj.redFlags.some((f) => f === 'RF070' || f === 'RF071' || f === 'RF072')
  ) {
    gates.push('pf-escalation');
  }

  // Customer exit → Senior Management per MoE guidance
  if (caseObj.recommendation === 'reject' || caseObj.recommendation === 'suspend') {
    gates.push('customer-exit');
  }

  return gates;
}

export function createApprovalRequest(
  caseId: string,
  gate: ApprovalGate,
  requestedBy: string
): ApprovalRequest {
  const urgency = gate === 'asset-freeze' || gate === 'pf-escalation' ? 'immediate' : 'standard';
  const regulatoryBasis = GATE_REGULATORY_BASIS[gate] ?? '';

  return {
    id: createId('appr'),
    caseId,
    requiredFor: gate,
    status: 'pending',
    requestedBy,
    requestedAt: nowIso(),
    urgency,
    regulatoryBasis,
  };
}

/** Gates that require the four-eyes principle (two independent approvers). */
const FOUR_EYES_GATES: ReadonlySet<ApprovalGate> = new Set([
  'pep-onboarding',
  'high-risk-onboarding',
  'asset-freeze',
  'pf-escalation',
]);

export function canProceedWithoutApproval(
  gates: ApprovalGate[],
  approvals: ApprovalRequest[]
): { canProceed: boolean; pendingGates: ApprovalGate[]; rejectedGates: ApprovalGate[] } {
  const rejectedGates = gates.filter((g) =>
    approvals.some((a) => a.requiredFor === g && a.status === 'rejected')
  );

  const pendingGates: ApprovalGate[] = [];

  for (const gate of gates) {
    if (rejectedGates.includes(gate)) continue;

    const gateApprovals = approvals.filter(
      (a) => a.requiredFor === gate && a.status === 'approved'
    );

    if (FOUR_EYES_GATES.has(gate)) {
      // Four-eyes: require 2+ independent approvers (Cabinet Res 134/2025 Art.12-14)
      const uniqueApprovers = new Set(gateApprovals.map((a) => a.decidedBy).filter(Boolean));
      if (uniqueApprovers.size < 2) {
        pendingGates.push(gate);
      }
    } else {
      if (gateApprovals.length === 0) {
        pendingGates.push(gate);
      }
    }
  }

  return {
    canProceed: pendingGates.length === 0 && rejectedGates.length === 0,
    pendingGates,
    rejectedGates,
  };
}

/** Regulatory basis for each approval gate — used in audit trail and Asana task notes. */
const GATE_REGULATORY_BASIS: Record<ApprovalGate, string> = {
  'pep-onboarding': 'FDL No.10/2025 Art.18, FATF Rec 12, Cabinet Res 134/2025 Art.8',
  'high-risk-onboarding':
    'FDL No.10/2025 Art.14-15, Cabinet Res 134/2025 Art.12-14 (4-Eyes Principle)',
  'edd-continuation': 'FDL No.10/2025 Art.14-15, FATF Rec 10, MoE DPMS Guidance',
  'str-approval': 'FDL No.10/2025 Art.26, FIU goAML Procedures, FATF Rec 20',
  'sar-approval': 'FDL No.10/2025 Art.26, FIU Reporting Framework',
  'ctr-approval': 'FDL No.10/2025 Art.16, MoE Circular 08/AML/2021, FATF Rec 22',
  'policy-exception': 'Cabinet Res 134/2025 Art.16, Internal Compliance Policy',
  'asset-freeze': 'FDL No.10/2025 Art.23, Cabinet Res 156/2025, EOCN Protocol, UNSC Resolutions',
  'customer-exit': 'FDL No.10/2025 Art.14, MoE Guidance on Customer Off-boarding, FATF Rec 10',
  'pf-escalation':
    'Cabinet Res 156/2025 Art.3-5, FATF Rec 7, UNSC Res 1718/2231, EOCN 24h Protocol',
};
