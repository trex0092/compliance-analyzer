export type ReportStatus =
  | 'draft'
  | 'ready'
  | 'approved'
  | 'exported'
  | 'submitted'
  | 'acknowledged'
  | 'returned'
  | 'resubmitted'
  | 'closed';

export type ReportType =
  | 'STR'
  | 'SAR'
  | 'CTR'
  | 'DPMSR'
  | 'FFR'
  | 'AIF'
  | 'AIFT'
  | 'HRC'
  | 'HRCA'
  | 'PNMR'
  | 'CNMR';

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: 'Draft',
  ready: 'Ready for Review',
  approved: 'Approved',
  exported: 'XML Exported',
  submitted: 'Submitted to FIU',
  acknowledged: 'Acknowledged',
  returned: 'Returned by FIU',
  resubmitted: 'Resubmitted',
  closed: 'Closed',
};

export const REPORT_STATUS_COLORS: Record<ReportStatus, string> = {
  draft: '#8b949e',
  ready: '#3B82F6',
  approved: '#d4a843',
  exported: '#06B6D4',
  submitted: '#8B5CF6',
  acknowledged: '#238636',
  returned: '#D94F4F',
  resubmitted: '#E8A030',
  closed: '#484f58',
};

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  STR: 'Suspicious Transaction Report',
  SAR: 'Suspicious Activity Report',
  CTR: 'Cash Transaction Report',
  DPMSR: 'DPMS Suspicious Report',
  FFR: 'Funds Freeze Report',
  AIF: 'Additional Information Form',
  AIFT: 'Additional Info Follow-up',
  HRC: 'High Risk Customer Report',
  HRCA: 'High Risk Customer Activity',
  PNMR: 'Partial Name Match Report',
  CNMR: 'Confirmed Name Match Report',
};

export interface SuspicionReport {
  id: string;
  caseId: string;
  reportType: ReportType;
  status: ReportStatus;
  reasonForSuspicion: string;
  facts: string[];
  redFlags: string[];
  parties: Array<{
    name: string;
    role: string;
    country?: string;
    idType?: string;
    idNumber?: string;
  }>;
  transactions: Array<{
    date?: string;
    amount?: number;
    currency?: string;
    summary: string;
    paymentMethod?: string;
    originCountry?: string;
    destinationCountry?: string;
  }>;
  /** goAML severity classification */
  severity?: 'low' | 'medium' | 'high' | 'critical';
  /** Reporting entity identification */
  reportingEntityId?: string;
  reportingEntityName?: string;
  /** AML risk assessment summary */
  riskAssessmentSummary?: string;
  /** Use/source of proceeds analysis per FIU requirements */
  useOfProceeds?: string;
  sourceOfProceeds?: string;
  /** Precious metals specific fields for DPMSR/CTR */
  commodityType?: string;
  weightGrams?: number;
  purity?: number;
  generatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  submissionRef?: string;
  submittedAt?: string;
  submissionMethod?: 'goaml-portal' | 'manual' | 'api';
  /** FIU follow-up tracking */
  followUpStatus?: 'pending' | 'acknowledged' | 'info-requested' | 'closed';
  followUpNotes?: string;
  fiuReferenceNo?: string;
  fiuAcknowledgedAt?: string;
  infoRequestedAt?: string;
  infoRequestDetails?: string;
  supplementaryFiledAt?: string;
  postFilingMonitoringEndDate?: string;
  /** Regulatory reference for this specific report */
  regulatoryBasis?: string;

  /** Return details when FIU sends report back */
  returnReason?: string;
  returnedAt?: string;
  returnedBy?: string;

  /** Entity name for display (only visible to CO/MLRO per Art.29) */
  entityName?: string;

  /** Amount for quick display */
  amount?: number;
  currency?: string;
}
