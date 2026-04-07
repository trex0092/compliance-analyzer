export type CaseType =
  | 'onboarding'
  | 'transaction-monitoring'
  | 'screening-hit'
  | 'sanctions-hit'
  | 'periodic-review'
  | 'sourcing-review'
  | 'incident'
  | 'regulatory-breach'
  | 'pf-screening'
  | 'adverse-media'
  | 'third-party-payment'
  | 'customer-exit';

export type CaseStatus =
  | 'open'
  | 'under-review'
  | 'pending-info'
  | 'escalated'
  | 'approved'
  | 'reported'
  | 'closed'
  | 'rejected';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type Recommendation =
  | 'continue'
  | 'edd'
  | 'reject'
  | 'suspend'
  | 'str-review'
  | 'sar-review'
  | 'ctr-filing'
  | 'freeze';

export type AuditAction =
  | 'created'
  | 'updated'
  | 'risk-recalculated'
  | 'assigned'
  | 'status-changed'
  | 'decision-recorded'
  | 'evidence-linked'
  | 'goaml-exported'
  | 'approval-requested'
  | 'approval-approved'
  | 'approval-rejected'
  | 'str-filed'
  | 'sar-filed'
  | 'ctr-filed'
  | 'escalated-to-mlro'
  | 'escalated-to-fiu'
  | 'escalated-to-eocn'
  | 'asset-frozen'
  | 'asset-unfrozen'
  | 'pf-alert-generated'
  | 'customer-exit-initiated'
  | 'screening-completed'
  | 'comment-added';

export interface AuditEvent {
  id: string;
  at: string;
  by: string;
  action: AuditAction;
  note?: string;
  before?: unknown;
  after?: unknown;
  regulatoryRef?: string;
}

export interface CaseDecision {
  outcome:
    | 'continue'
    | 'continue-with-edd'
    | 'reject'
    | 'suspend'
    | 'freeze'
    | 'file-str'
    | 'file-sar'
    | 'file-ctr';
  reason: string;
  decidedBy: string;
  decidedAt: string;
  regulatoryBasis?: string;
}

export interface ComplianceCase {
  id: string;
  entityId: string;
  caseType: CaseType;
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  assignedTo?: string;
  sourceModule:
    | 'analyze'
    | 'iar'
    | 'shipments'
    | 'screening'
    | 'onboarding'
    | 'incidents'
    | 'manual'
    | 'pf-monitoring'
    | 'fiu-followup'
    | 'eocn-directive';
  riskScore: number;
  riskLevel: RiskLevel;
  redFlags: string[];
  findings: string[];
  narrative: string;
  recommendation: Recommendation;
  decision?: CaseDecision;
  linkedCustomerId?: string;
  linkedShipmentIds?: string[];
  linkedTaskIds?: string[];
  linkedEvidenceIds?: string[];
  linkedReportIds?: string[];
  auditLog: AuditEvent[];
  /** FIU reference number after STR/SAR filing */
  fiuReferenceNo?: string;
  /** EOCN directive reference for PF/sanctions cases */
  eocnDirectiveRef?: string;
  /** Date when post-filing monitoring ends */
  postFilingMonitoringEndDate?: string;
}
