export type TMRuleId =
  | "structuring"
  | "profile-mismatch"
  | "third-party-payment"
  | "offshore-routing"
  | "rapid-buy-sell"
  | "cash-threshold"
  | "round-tripping"
  | "valuation-anomaly";

export interface TMRule {
  id: TMRuleId;
  name: string;
  description: string;
  severity: "medium" | "high" | "critical";
  regulatoryRef: string;
  detect: (tx: TransactionInput) => boolean;
}

export interface TransactionInput {
  amount: number;
  currency: string;
  customerName: string;
  customerRiskRating: "low" | "medium" | "high";
  payerMatchesCustomer: boolean;
  originCountry?: string;
  destinationCountry?: string;
  transactionsLast30Days?: number;
  cumulativeAmountLast30Days?: number;
  isReturn?: boolean;
  declaredValue?: number;
  marketValue?: number;
  paymentMethod?: string;
}

export interface TMAlert {
  ruleId: TMRuleId;
  ruleName: string;
  severity: "medium" | "high" | "critical";
  message: string;
  regulatoryRef: string;
}

const HIGH_RISK_COUNTRIES = [
  "AF", "MM", "SY", "IR", "KP", "IQ", "LY", "SO", "SS", "SD", "YE",
  "CD", "CF",
];

export const TM_RULES: TMRule[] = [
  {
    id: "structuring",
    name: "Structuring / Smurfing Detection",
    description: "Multiple transactions just below AED 55,000 within 30 days",
    severity: "critical",
    regulatoryRef: "FDL No.10/2025 Art.15-16, FATF Rec 22",
    detect: (tx) =>
      (tx.cumulativeAmountLast30Days ?? 0) >= 55000 &&
      (tx.transactionsLast30Days ?? 0) >= 3 &&
      tx.amount < 55000 &&
      tx.amount > 40000,
  },
  {
    id: "profile-mismatch",
    name: "Transaction-Profile Mismatch",
    description: "Transaction amount inconsistent with customer risk profile",
    severity: "high",
    regulatoryRef: "Cabinet Resolution 134/2025 Art.16, UAE NRA 2024",
    detect: (tx) =>
      (tx.customerRiskRating === "low" && tx.amount > 200000) ||
      (tx.customerRiskRating === "medium" && tx.amount > 500000),
  },
  {
    id: "third-party-payment",
    name: "Third-Party Payer Detection",
    description: "Payment from party other than identified customer",
    severity: "high",
    regulatoryRef: "Cabinet Resolution 134/2025 Art.6(3), FATF Rec 10/22",
    detect: (tx) => !tx.payerMatchesCustomer,
  },
  {
    id: "offshore-routing",
    name: "Offshore / High-Risk Jurisdiction Routing",
    description: "Transaction routed through FATF grey/black list jurisdiction",
    severity: "critical",
    regulatoryRef: "FDL No.10/2025 Art.17, FATF Rec 19",
    detect: (tx) =>
      HIGH_RISK_COUNTRIES.includes(tx.originCountry ?? "") ||
      HIGH_RISK_COUNTRIES.includes(tx.destinationCountry ?? ""),
  },
  {
    id: "rapid-buy-sell",
    name: "Rapid Buy-Sell Cycle",
    description: "Purchase and return/resale within short period",
    severity: "high",
    regulatoryRef: "UAE NRA 2024 DPMS risk indicators",
    detect: (tx) => !!tx.isReturn && tx.amount > 20000,
  },
  {
    id: "cash-threshold",
    name: "Cash Transaction ≥ AED 55,000",
    description: "Single cash transaction at or above DPMSR threshold",
    severity: "critical",
    regulatoryRef: "FDL No.10/2025 Art.16, FATF Rec 22, MoE Circular 08/AML/2021",
    detect: (tx) =>
      tx.paymentMethod === "cash" && tx.amount >= 55000,
  },
  {
    id: "round-tripping",
    name: "Round-Tripping Detection",
    description: "Circular payment patterns suggesting layering",
    severity: "critical",
    regulatoryRef: "FDL No.10/2025, FATF Typologies",
    detect: (tx) =>
      tx.originCountry === tx.destinationCountry &&
      tx.amount > 100000 &&
      !tx.payerMatchesCustomer,
  },
  {
    id: "valuation-anomaly",
    name: "Precious Stones Valuation Anomaly",
    description: "Declared value deviates >25% from market benchmark",
    severity: "high",
    regulatoryRef: "UAE NRA 2024, FATF Rec 20",
    detect: (tx) => {
      if (!tx.declaredValue || !tx.marketValue) return false;
      const deviation = Math.abs(tx.declaredValue - tx.marketValue) / tx.marketValue;
      return deviation > 0.25;
    },
  },
];

export function runTransactionMonitoring(tx: TransactionInput): TMAlert[] {
  return TM_RULES.filter((rule) => rule.detect(tx)).map((rule) => ({
    ruleId: rule.id,
    ruleName: rule.name,
    severity: rule.severity,
    message: `${rule.name}: ${rule.description}. Customer: ${tx.customerName}, Amount: ${tx.currency} ${tx.amount}.`,
    regulatoryRef: rule.regulatoryRef,
  }));
}
