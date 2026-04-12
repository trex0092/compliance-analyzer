/**
 * Hawala / Informal Value Transfer System (IVTS) Detector
 *
 * Detects hawala and other informal value transfer patterns in DPMS
 * gold transactions, including mirror trades, commodity-backed settlements
 * and broker chain structures.
 *
 * Regulatory: FDL No.10/2025 Art.12-14, FATF Typology on Hawala (2013,
 *             2018 update), Cabinet Res 134/2025 Art.7-10, UAE Central
 *             Bank Hawala Registration Requirement (2022), MoE Circular
 *             08/AML/2021, FATF Rec 14 (Money or Value Transfer Services).
 *
 * All regulatory thresholds are imported from src/domain/constants.ts —
 * the single source of truth. Never redefine locally.
 */

import { CROSS_BORDER_CASH_THRESHOLD_AED } from '../domain/constants';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HawalaIndicator =
  | 'unregistered_hawaladar'
  | 'mirror_trade'
  | 'commodity_backed_settlement'
  | 'broker_chain'
  | 'no_formal_banking'
  | 'cross_border_no_declaration'
  | 'periodic_netting'
  | 'same_day_offsetting'
  | 'value_without_movement'
  | 'trust_based_settlement';

export type HawalaRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface HawalaTransaction {
  transactionId: string;
  amountAED: number;
  isCash: boolean;
  crossBorder: boolean;
  declaredForCustoms: boolean;
  counterpartyType: 'registered_dealer' | 'unregistered_individual' | 'broker' | 'unknown';
  paymentMethod:
    | 'bank_transfer'
    | 'cash'
    | 'crypto'
    | 'informal_settlement'
    | 'commodity_swap'
    | 'netting';
  correspondingOutwardTransaction?: {
    transactionId: string;
    amountAED: number;
    jurisdictionCode: string;
    timeDifferenceHours: number;
  };
  brokerChainLength?: number; // number of intermediaries
  hasFormalBankRecord: boolean;
  settlementJurisdiction?: string;
  goodsMovementConfirmed: boolean; // was physical gold actually moved?
  invoiceMatchesPayment: boolean;
}

export interface HawalaDetectionResult {
  transactionId: string;
  generatedAt: string;
  riskLevel: HawalaRiskLevel;
  score: number; // 0–100
  indicators: HawalaIndicatorDetail[];
  requiresStr: boolean;
  requiresCbuaeReport: boolean; // UAE CBUAE Hawala Registry reporting
  narrativeSummary: string;
  regulatoryRefs: string[];
}

export interface HawalaIndicatorDetail {
  indicator: HawalaIndicator;
  severity: HawalaRiskLevel;
  weight: number;
  description: string;
  regulatoryRef: string;
}

// ─── Indicator Definitions ────────────────────────────────────────────────────
// Cross-border threshold comes from CROSS_BORDER_CASH_THRESHOLD_AED in
// src/domain/constants.ts — Cabinet Res 134/2025 Art.16. Never hardcode here.

function detectIndicators(tx: HawalaTransaction): HawalaIndicatorDetail[] {
  const found: HawalaIndicatorDetail[] = [];

  // 1. Unregistered hawaladar
  if (tx.counterpartyType === 'unregistered_individual' && !tx.hasFormalBankRecord) {
    found.push({
      indicator: 'unregistered_hawaladar',
      severity: 'critical',
      weight: 30,
      description:
        'Transaction with unregistered individual lacking formal bank record — IVTS indicator',
      regulatoryRef: 'UAE CBUAE Hawala Registration Requirement 2022; FATF Rec 14',
    });
  }

  // 2. Mirror trade
  if (tx.correspondingOutwardTransaction) {
    const mirror = tx.correspondingOutwardTransaction;
    const amountMatch = Math.abs(tx.amountAED - mirror.amountAED) / tx.amountAED < 0.05;
    const sameDay = mirror.timeDifferenceHours <= 24;
    if (amountMatch && sameDay) {
      found.push({
        indicator: 'mirror_trade',
        severity: 'critical',
        weight: 35,
        description: `Mirror trade detected: inbound AED ${tx.amountAED.toLocaleString()} ↔ outbound AED ${mirror.amountAED.toLocaleString()} to ${mirror.jurisdictionCode} within ${mirror.timeDifferenceHours}h`,
        regulatoryRef: 'FATF Typology on Hawala 2018 §2.3; FDL No.10/2025 Art.12',
      });
    }
  }

  // 3. Commodity-backed settlement (gold used as settlement mechanism)
  if (tx.paymentMethod === 'commodity_swap' && !tx.goodsMovementConfirmed) {
    found.push({
      indicator: 'commodity_backed_settlement',
      severity: 'high',
      weight: 25,
      description:
        'Commodity swap payment with no confirmed physical movement — possible hawala settlement',
      regulatoryRef: 'FATF Typology on Hawala 2018 §3.1; LBMA RGG v9 §5',
    });
  }

  // 4. Broker chain
  if (
    tx.brokerChainLength !== null &&
    tx.brokerChainLength !== undefined &&
    tx.brokerChainLength >= 3
  ) {
    found.push({
      indicator: 'broker_chain',
      severity: 'high',
      weight: 20,
      description: `${tx.brokerChainLength}-level broker chain — layering risk, obscures beneficial owner`,
      regulatoryRef: 'FATF Rec 14; Cabinet Res 134/2025 Art.7',
    });
  }

  // 5. No formal banking
  if (!tx.hasFormalBankRecord && tx.amountAED > 10_000) {
    found.push({
      indicator: 'no_formal_banking',
      severity: 'medium',
      weight: 15,
      description:
        'No formal banking record for non-trivial transaction — value transfer without paper trail',
      regulatoryRef: 'FDL No.10/2025 Art.12; FATF Typology on Hawala 2013 §2.1',
    });
  }

  // 6. Cross-border without declaration
  if (tx.crossBorder && !tx.declaredForCustoms && tx.amountAED >= CROSS_BORDER_CASH_THRESHOLD_AED) {
    found.push({
      indicator: 'cross_border_no_declaration',
      severity: 'critical',
      weight: 30,
      description: `Cross-border transaction AED ${tx.amountAED.toLocaleString()} ≥ AED ${CROSS_BORDER_CASH_THRESHOLD_AED.toLocaleString()} not declared to customs`,
      regulatoryRef: 'Cabinet Res 134/2025 Art.16 — cross-border cash declaration',
    });
  }

  // 7. Informal settlement / netting
  if (tx.paymentMethod === 'netting' || tx.paymentMethod === 'informal_settlement') {
    found.push({
      indicator: 'periodic_netting',
      severity: 'medium',
      weight: 15,
      description: 'Periodic netting / informal settlement — hawala broker pattern',
      regulatoryRef: 'FATF Typology on Hawala 2018 §2.4',
    });
  }

  // 8. Value without physical movement
  if (!tx.goodsMovementConfirmed && tx.amountAED > 50_000) {
    found.push({
      indicator: 'value_without_movement',
      severity: 'high',
      weight: 20,
      description: 'Significant value transferred without confirmed physical goods movement',
      regulatoryRef: 'FATF Typology on Hawala 2018 §3.2; LBMA RGG v9 §4',
    });
  }

  // 9. Invoice / payment mismatch
  if (!tx.invoiceMatchesPayment) {
    found.push({
      indicator: 'trust_based_settlement',
      severity: 'medium',
      weight: 15,
      description:
        'Payment amount does not match invoice — informal / trust-based settlement possible',
      regulatoryRef: 'FDL No.10/2025 Art.13; Cabinet Res 134/2025 Art.9',
    });
  }

  return found;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function detectHawala(tx: HawalaTransaction): HawalaDetectionResult {
  const indicators = detectIndicators(tx);

  // Weighted composite score
  const score = Math.min(
    100,
    indicators.reduce((s, i) => s + i.weight, 0)
  );

  const riskLevel: HawalaRiskLevel =
    score >= 60 ? 'critical' : score >= 35 ? 'high' : score >= 15 ? 'medium' : 'low';

  const requiresStr = score >= 60 || indicators.some((i) => i.severity === 'critical');
  const requiresCbuaeReport = indicators.some(
    (i) => i.indicator === 'unregistered_hawaladar' || i.indicator === 'mirror_trade'
  );

  const narrativeSummary =
    `Transaction ${tx.transactionId}: Hawala/IVTS score ${score}/100 (${riskLevel.toUpperCase()}). ` +
    `${indicators.length} indicator(s): ${indicators.map((i) => i.indicator.replace(/_/g, ' ')).join(', ') || 'none'}. ` +
    `STR required: ${requiresStr}. CBUAE report required: ${requiresCbuaeReport}.`;

  return {
    transactionId: tx.transactionId,
    generatedAt: new Date().toISOString(),
    riskLevel,
    score,
    indicators,
    requiresStr,
    requiresCbuaeReport,
    narrativeSummary,
    regulatoryRefs: [
      'FATF Guidance on Hawala and other Similar Service Providers (2013, updated 2018)',
      'FATF Recommendation 14 — Money or Value Transfer Services',
      'FDL No.10/2025 Art.12-14 — CDD obligations',
      'Cabinet Res 134/2025 Art.16 — Cross-border AED 60K declaration',
      'UAE CBUAE Hawala Registration Requirement 2022',
      'MoE Circular 08/AML/2021',
    ],
  };
}
