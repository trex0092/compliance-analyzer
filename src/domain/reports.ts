export interface SuspicionReport {
  id: string;
  caseId: string;
  reportType: "STR" | "SAR";
  status: "draft" | "approved" | "exported";
  reasonForSuspicion: string;
  facts: string[];
  redFlags: string[];
  parties: Array<{
    name: string;
    role: string;
    country?: string;
  }>;
  transactions: Array<{
    date?: string;
    amount?: number;
    currency?: string;
    summary: string;
  }>;
  generatedAt: string;
  approvedBy?: string;
  approvedAt?: string;
}
