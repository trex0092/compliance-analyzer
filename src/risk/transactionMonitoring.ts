import {
  LOW_RISK_PROFILE_THRESHOLD_AED,
  MEDIUM_RISK_PROFILE_THRESHOLD_AED,
  ROUND_TRIPPING_THRESHOLD_AED,
  RAPID_BUYSELL_THRESHOLD_AED,
  DORMANCY_REACTIVATION_MIN_AED,
  DORMANCY_DAYS,
  CERTIFICATION_THRESHOLD_AED,
  DPMS_CASH_THRESHOLD_AED,
  STRUCTURING_CUMULATIVE_PCT,
  VALUATION_ANOMALY_PCT,
  WEIGHT_DISCREPANCY_PCT,
} from '../domain/constants';

export type TMRuleId =
  | 'structuring'
  | 'profile-mismatch'
  | 'third-party-payment'
  | 'offshore-routing'
  | 'rapid-buy-sell'
  | 'cash-threshold'
  | 'round-tripping'
  | 'valuation-anomaly'
  | 'weight-discrepancy'
  | 'missing-certification'
  | 'dormancy-reactivation'
  | 'threshold-avoidance';

export interface TMRule {
  id: TMRuleId;
  name: string;
  description: string;
  severity: 'medium' | 'high' | 'critical';
  regulatoryRef: string;
  detect: (tx: TransactionInput, config?: TMConfig) => boolean;
}

export interface TransactionInput {
  amount: number;
  currency: string;
  customerName: string;
  customerRiskRating: 'low' | 'medium' | 'high';
  payerMatchesCustomer: boolean;
  originCountry?: string;
  destinationCountry?: string;
  transactionsLast30Days?: number;
  cumulativeAmountLast30Days?: number;
  isReturn?: boolean;
  declaredValue?: number;
  marketValue?: number;
  paymentMethod?: string;
  /** Precious metals specific fields */
  declaredWeightGrams?: number;
  actualWeightGrams?: number;
  declaredPurity?: number;
  assayPurity?: number;
  hasHallmark?: boolean;
  hasAssayCertificate?: boolean;
  hasCertificateOfOrigin?: boolean;
  commodityType?: string;
  daysSinceLastTransaction?: number;
  customerRequestedThresholdInfo?: boolean;
  /**
   * Free-text MLRO context attached to the transaction — purpose,
   * source of funds, anomalies worth flagging to the reviewer.
   * Not used by the rule engine; rendered into downstream Asana task
   * bodies and retained for audit trail (FDL No.10/2025 Art.24).
   */
  notes?: string;
}

export interface TMAlert {
  ruleId: TMRuleId;
  ruleName: string;
  severity: 'medium' | 'high' | 'critical';
  message: string;
  regulatoryRef: string;
}

export interface TMConfig {
  highRiskCountries: string[];
  cashThreshold: number;
}

// Default list — can be overridden at runtime via TMConfig
export const DEFAULT_HIGH_RISK_COUNTRIES = [
  'AF',
  'MM',
  'SY',
  'IR',
  'KP',
  'IQ',
  'LY',
  'SO',
  'SS',
  'SD',
  'YE',
  'CD',
  'CF',
];

export const DEFAULT_TM_CONFIG: TMConfig = {
  highRiskCountries: DEFAULT_HIGH_RISK_COUNTRIES,
  cashThreshold: DPMS_CASH_THRESHOLD_AED,
};

export const TM_RULES: TMRule[] = [
  {
    id: 'structuring',
    name: 'Structuring / Smurfing Detection',
    description: 'Multiple transactions just below AED 55,000 within 30 days',
    severity: 'critical',
    regulatoryRef: 'FDL No.10/2025 Art.15-16, FATF Rec 22',
    detect: (tx, config) => {
      const threshold = config?.cashThreshold ?? DEFAULT_TM_CONFIG.cashThreshold;
      return (
        (tx.cumulativeAmountLast30Days ?? 0) >= threshold &&
        (tx.transactionsLast30Days ?? 0) >= 3 &&
        tx.amount < threshold &&
        tx.amount > threshold * STRUCTURING_CUMULATIVE_PCT
      );
    },
  },
  {
    id: 'profile-mismatch',
    name: 'Transaction-Profile Mismatch',
    description: 'Transaction amount inconsistent with customer risk profile',
    severity: 'high',
    regulatoryRef: 'Cabinet Resolution 134/2025 Art.16, UAE NRA 2024',
    detect: (tx) =>
      (tx.customerRiskRating === 'low' && tx.amount > LOW_RISK_PROFILE_THRESHOLD_AED) ||
      (tx.customerRiskRating === 'medium' && tx.amount > MEDIUM_RISK_PROFILE_THRESHOLD_AED),
  },
  {
    id: 'third-party-payment',
    name: 'Third-Party Payer Detection',
    description: 'Payment from party other than identified customer',
    severity: 'high',
    regulatoryRef: 'Cabinet Resolution 134/2025 Art.6(3), FATF Rec 10/22',
    detect: (tx) => !tx.payerMatchesCustomer,
  },
  {
    id: 'offshore-routing',
    name: 'Offshore / High-Risk Jurisdiction Routing',
    description: 'Transaction routed through FATF grey/black list jurisdiction',
    severity: 'critical',
    regulatoryRef: 'FDL No.10/2025 Art.17, FATF Rec 19',
    detect: (tx, config) => {
      const countries = config?.highRiskCountries ?? DEFAULT_TM_CONFIG.highRiskCountries;
      return (
        countries.includes(tx.originCountry ?? '') ||
        countries.includes(tx.destinationCountry ?? '')
      );
    },
  },
  {
    id: 'rapid-buy-sell',
    name: 'Rapid Buy-Sell Cycle',
    description: 'Purchase and return/resale within short period',
    severity: 'high',
    regulatoryRef: 'UAE NRA 2024 DPMS risk indicators',
    detect: (tx) => !!tx.isReturn && tx.amount > RAPID_BUYSELL_THRESHOLD_AED,
  },
  {
    id: 'cash-threshold',
    name: 'Cash Transaction >= AED 55,000',
    description: 'Single cash transaction at or above DPMSR threshold',
    severity: 'critical',
    regulatoryRef: 'FDL No.10/2025 Art.16, FATF Rec 22, MoE Circular 08/AML/2021',
    detect: (tx, config) => {
      const threshold = config?.cashThreshold ?? DEFAULT_TM_CONFIG.cashThreshold;
      return tx.paymentMethod === 'cash' && tx.amount >= threshold;
    },
  },
  {
    id: 'round-tripping',
    name: 'Round-Tripping Detection',
    description: 'Circular payment patterns suggesting layering',
    severity: 'critical',
    regulatoryRef: 'FDL No.10/2025, FATF Typologies',
    detect: (tx) =>
      !!tx.originCountry &&
      !!tx.destinationCountry &&
      tx.originCountry === tx.destinationCountry &&
      tx.amount > ROUND_TRIPPING_THRESHOLD_AED &&
      !tx.payerMatchesCustomer,
  },
  {
    id: 'valuation-anomaly',
    name: 'Precious Stones Valuation Anomaly',
    description: 'Declared value deviates >25% from market benchmark',
    severity: 'high',
    regulatoryRef: 'UAE NRA 2024, FATF Rec 20',
    detect: (tx) => {
      if (!tx.declaredValue || !tx.marketValue || tx.marketValue === 0) return false;
      const deviation = Math.abs(tx.declaredValue - tx.marketValue) / tx.marketValue;
      return deviation > VALUATION_ANOMALY_PCT;
    },
  },
  // ─── Precious Metals Specific Rules (MoE/LBMA) ──────────────────────────
  {
    id: 'weight-discrepancy',
    name: 'Weight / Purity Discrepancy',
    description: 'Declared weight or purity deviates from assay results by >5%',
    severity: 'high',
    regulatoryRef: 'LBMA Good Delivery Rules, MoE DPMS Guidance, UAE Standards (ESMA)',
    detect: (tx) => {
      if (tx.declaredWeightGrams && tx.actualWeightGrams && tx.actualWeightGrams > 0) {
        const deviation =
          Math.abs(tx.declaredWeightGrams - tx.actualWeightGrams) / tx.actualWeightGrams;
        if (deviation > WEIGHT_DISCREPANCY_PCT) return true;
      }
      if (tx.declaredPurity && tx.assayPurity && tx.assayPurity > 0) {
        const purityDev = Math.abs(tx.declaredPurity - tx.assayPurity) / tx.assayPurity;
        if (purityDev > WEIGHT_DISCREPANCY_PCT) return true;
      }
      return false;
    },
  },
  {
    id: 'missing-certification',
    name: 'Missing Hallmark / Assay / Origin Certificate',
    description: 'Precious metals lacking required hallmark, assay, or certificate of origin',
    severity: 'high',
    regulatoryRef: 'MoE DPMS Regulations, LBMA GDR, OECD DDG, UAE Customs',
    detect: (tx) =>
      tx.amount > CERTIFICATION_THRESHOLD_AED &&
      (!tx.hasHallmark || !tx.hasAssayCertificate || !tx.hasCertificateOfOrigin),
  },
  {
    id: 'dormancy-reactivation',
    name: 'Transaction After Prolonged Dormancy',
    description: 'Significant transaction following >90 days of inactivity',
    severity: 'medium',
    regulatoryRef: 'FDL No.10/2025 Art.15, MoE DPMS Guidance',
    detect: (tx) =>
      (tx.daysSinceLastTransaction ?? 0) > DORMANCY_DAYS &&
      tx.amount > DORMANCY_REACTIVATION_MIN_AED,
  },
  {
    id: 'threshold-avoidance',
    name: 'Customer Inquiring About Reporting Thresholds',
    description: 'Customer asks about reporting limits or requests to stay below threshold',
    severity: 'critical',
    regulatoryRef: 'FDL No.10/2025 Art.16/26, MoE Circular 08/AML/2021, FATF Rec 22',
    detect: (tx) => !!tx.customerRequestedThresholdInfo,
  },
];

export function runTransactionMonitoring(tx: TransactionInput, config?: TMConfig): TMAlert[] {
  if (!tx.customerName || tx.amount === null || tx.amount === undefined) return [];

  return TM_RULES.filter((rule) => rule.detect(tx, config)).map((rule) => ({
    ruleId: rule.id,
    ruleName: rule.name,
    severity: rule.severity,
    message: `${rule.name}: ${rule.description}. Customer: ${tx.customerName}, Amount: ${tx.currency} ${tx.amount}.`,
    regulatoryRef: rule.regulatoryRef,
  }));
}
