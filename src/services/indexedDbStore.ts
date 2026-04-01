import type { AppStore } from "./store";
import type { ComplianceCase } from "../domain/cases";
import type { CustomerProfile } from "../domain/customers";
import type { EvidenceItem } from "../domain/evidence";
import type { ScreeningRun } from "../domain/screening";
import type { SuspicionReport } from "../domain/reports";
import type { ApprovalRequest } from "../domain/approvals";
import type { Alert } from "../domain/alerts";

function read<T>(key: string): T[] {
  const raw = localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T[]) : [];
}

function write<T>(key: string, value: T[]): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const idx = items.findIndex((x) => x.id === item.id);
  if (idx >= 0) {
    const next = [...items];
    next[idx] = item;
    return next;
  }
  return [item, ...items];
}

export class LocalAppStore implements AppStore {
  async getCases(): Promise<ComplianceCase[]> {
    return read<ComplianceCase>("cases");
  }
  async saveCase(item: ComplianceCase): Promise<void> {
    write("cases", upsertById(read<ComplianceCase>("cases"), item));
  }

  async getCustomers(): Promise<CustomerProfile[]> {
    return read<CustomerProfile>("customers");
  }
  async saveCustomer(item: CustomerProfile): Promise<void> {
    write("customers", upsertById(read<CustomerProfile>("customers"), item));
  }

  async getEvidence(): Promise<EvidenceItem[]> {
    return read<EvidenceItem>("evidence");
  }
  async saveEvidence(item: EvidenceItem): Promise<void> {
    write("evidence", upsertById(read<EvidenceItem>("evidence"), item));
  }

  async getScreeningRuns(): Promise<ScreeningRun[]> {
    return read<ScreeningRun>("screeningRuns");
  }
  async saveScreeningRun(item: ScreeningRun): Promise<void> {
    write("screeningRuns", upsertById(read<ScreeningRun>("screeningRuns"), item));
  }

  async getReports(): Promise<SuspicionReport[]> {
    return read<SuspicionReport>("reports");
  }
  async saveReport(item: SuspicionReport): Promise<void> {
    write("reports", upsertById(read<SuspicionReport>("reports"), item));
  }

  async getApprovals(): Promise<ApprovalRequest[]> {
    return read<ApprovalRequest>("approvals");
  }
  async saveApproval(item: ApprovalRequest): Promise<void> {
    write("approvals", upsertById(read<ApprovalRequest>("approvals"), item));
  }

  async getAlerts(): Promise<Alert[]> {
    return read<Alert>("alerts");
  }
  async saveAlert(item: Alert): Promise<void> {
    write("alerts", upsertById(read<Alert>("alerts"), item));
  }
}
