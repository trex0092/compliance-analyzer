export interface ApprovalRequest {
  id: string;
  caseId: string;
  requiredFor:
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
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  note?: string;
  regulatoryBasis?: string;
  urgency?: 'standard' | 'urgent' | 'immediate';
}
