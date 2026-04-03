export interface SuspicionReport {
  id: string;
  caseId: string;
  reportType: "STR" | "SAR" | "CTR" | "DPMSR";
  status: "draft" | "approved" | "exported";
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
  severity?: "low" | "medium" | "high" | "critical";
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
  submissionMethod?: "goaml-portal" | "manual" | "api";
  /** FIU follow-up tracking */
  followUpStatus?: "pending" | "acknowledged" | "info-requested" | "closed";
  followUpNotes?: string;
  fiuReferenceNo?: string;
  fiuAcknowledgedAt?: string;
  infoRequestedAt?: string;
  infoRequestDetails?: string;
  supplementaryFiledAt?: string;
  postFilingMonitoringEndDate?: string;
  /** Regulatory reference for this specific report */
  regulatoryBasis?: string;
}
