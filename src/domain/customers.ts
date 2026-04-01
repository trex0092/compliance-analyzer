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
  groupId?: string;
  groupName?: string;
  entityType?: "headquarters" | "branch" | "subsidiary" | "standalone";
  asanaComplianceProjectGid?: string;
  asanaWorkflowProjectGid?: string;
  countryOfRegistration?: string;
  tradeLicenseNo?: string;
  sector?: string;
  activity?: string;
  location?: string;
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

export const COMPANY_REGISTRY: Omit<CustomerProfile, "beneficialOwners" | "reviewHistory">[] = [
  {
    id: "company-1",
    legalName: "MADISON JEWELLERY TRADING L.L.C",
    type: "customer",
    entityType: "standalone",
    asanaComplianceProjectGid: "1213825539896477",
    asanaWorkflowProjectGid: "1213825580399850",
    activity: "Jewellery Trading",
    location: "Dubai, UAE",
    countryOfRegistration: "UAE",
    sector: "precious-metals",
    riskRating: "medium",
    pepStatus: "clear",
    sanctionsStatus: "clear",
    sourceOfFundsStatus: "verified",
    sourceOfWealthStatus: "verified",
  },
  {
    id: "company-2",
    legalName: "NAPLES JEWELLERY TRADING L.L.C",
    type: "customer",
    entityType: "standalone",
    asanaComplianceProjectGid: "1213825365472836",
    asanaWorkflowProjectGid: "1213825542010518",
    activity: "Jewellery Trading",
    location: "Dubai, UAE",
    countryOfRegistration: "UAE",
    sector: "precious-metals",
    riskRating: "medium",
    pepStatus: "clear",
    sanctionsStatus: "clear",
    sourceOfFundsStatus: "verified",
    sourceOfWealthStatus: "verified",
  },
  {
    id: "company-3",
    legalName: "GRAMALTIN KIYMETLI MADENLER RAFINERI SANAYI VE TICARET ANONIM SIRKETI",
    type: "supplier",
    entityType: "standalone",
    asanaComplianceProjectGid: "1213838252710765",
    asanaWorkflowProjectGid: "1213825541970651",
    activity: "Precious Metal Refining & Trading",
    location: "Sharjah, UAE",
    countryOfRegistration: "UAE",
    sector: "precious-metals-refining",
    riskRating: "medium",
    pepStatus: "clear",
    sanctionsStatus: "clear",
    sourceOfFundsStatus: "verified",
    sourceOfWealthStatus: "verified",
  },
  {
    id: "company-4",
    legalName: "ZOE Precious Metals and Jewelery (FZE)",
    type: "customer",
    entityType: "standalone",
    asanaComplianceProjectGid: "1213825578259027",
    asanaWorkflowProjectGid: "1213825580398407",
    activity: "Precious Metals and Jewelery",
    location: "Sharjah, UAE",
    countryOfRegistration: "UAE",
    sector: "precious-metals",
    riskRating: "medium",
    pepStatus: "clear",
    sanctionsStatus: "clear",
    sourceOfFundsStatus: "verified",
    sourceOfWealthStatus: "verified",
  },
  {
    id: "company-5",
    legalName: "FINE GOLD LLC",
    type: "customer",
    groupId: "fg-group",
    groupName: "Fine Gold Group",
    entityType: "headquarters",
    asanaComplianceProjectGid: "1213900474912902",
    asanaWorkflowProjectGid: "1213759768596515",
    activity: "Non-Manufactured Precious Metal Trading",
    location: "Dubai, UAE",
    countryOfRegistration: "UAE",
    sector: "precious-metals-trading",
    riskRating: "medium",
    pepStatus: "clear",
    sanctionsStatus: "clear",
    sourceOfFundsStatus: "verified",
    sourceOfWealthStatus: "verified",
  },
  {
    id: "company-6",
    legalName: "FINE GOLD (BRANCH)",
    type: "customer",
    groupId: "fg-group",
    groupName: "Fine Gold Group",
    entityType: "branch",
    asanaComplianceProjectGid: "1213900370769721",
    asanaWorkflowProjectGid: "1213899469870046",
    activity: "Non-Manufactured Precious Metal Trading",
    location: "Sharjah, UAE",
    countryOfRegistration: "UAE",
    sector: "precious-metals-trading",
    riskRating: "medium",
    pepStatus: "clear",
    sanctionsStatus: "clear",
    sourceOfFundsStatus: "verified",
    sourceOfWealthStatus: "verified",
  },
];
