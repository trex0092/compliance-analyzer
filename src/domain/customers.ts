export interface UBORecord {
  id: string;
  fullName: string;
  nationality?: string;
  ownershipPercent?: number;
  pepStatus: "clear" | "match" | "potential-match";
  sanctionsStatus: "clear" | "match" | "potential-match";
}

export interface ReviewRecord {
  id: string;
  reviewedAt: string;
  reviewedBy: string;
  summary: string;
  riskRating: "low" | "medium" | "high";
}

export interface CustomerProfile {
  id: string;
  legalName: string;
  type: "supplier" | "customer" | "agent" | "intermediary";
  countryOfRegistration?: string;
  tradeLicenseNo?: string;
  sector?: string;
  ownershipComplexity?: boolean;
  riskRating: "low" | "medium" | "high";
  lastCDDReviewDate?: string;
  nextCDDReviewDate?: string;
  pepStatus: "clear" | "match" | "potential-match";
  sanctionsStatus: "clear" | "match" | "potential-match";
  sourceOfFundsStatus: "verified" | "pending" | "failed";
  sourceOfWealthStatus: "verified" | "pending" | "failed";
  beneficialOwners: UBORecord[];
  reviewHistory: ReviewRecord[];
}
