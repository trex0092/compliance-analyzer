import type { ComplianceCase } from '../domain/cases';
import type { CustomerProfile } from '../domain/customers';
import type { EvidenceItem } from '../domain/evidence';
import type { ScreeningRun } from '../domain/screening';
import type { SuspicionReport } from '../domain/reports';
import type { ApprovalRequest } from '../domain/approvals';
import type { Alert } from '../domain/alerts';

export interface AppStore {
  getCases(): Promise<ComplianceCase[]>;
  saveCase(item: ComplianceCase): Promise<void>;

  getCustomers(): Promise<CustomerProfile[]>;
  saveCustomer(item: CustomerProfile): Promise<void>;

  getEvidence(): Promise<EvidenceItem[]>;
  saveEvidence(item: EvidenceItem): Promise<void>;

  getScreeningRuns(): Promise<ScreeningRun[]>;
  saveScreeningRun(item: ScreeningRun): Promise<void>;

  getReports(): Promise<SuspicionReport[]>;
  saveReport(item: SuspicionReport): Promise<void>;

  getApprovals(): Promise<ApprovalRequest[]>;
  saveApproval(item: ApprovalRequest): Promise<void>;

  getAlerts(): Promise<Alert[]>;
  saveAlert(item: Alert): Promise<void>;
}
