/**
 * Buy-Back Risk Engine — cash-for-gold inbound scoring.
 *
 * The single largest DPMS laundering typology per MoE 08/AML/2021 is
 * inbound gold from individuals with cash payout and unclear source.
 * This module scores every such transaction and produces an
 * explainable risk decomposition.
 *
 * Red flag catalogue (additive scoring):
 *
 *   • No invoice / unclear provenance           +25
 *   • Repeat seller within 24h                  +20
 *   • Repeat seller same week, diff amounts     +15
 *   • Cash payout >= AED 55K                    +20
 *   • Declared purity ≠ measured purity         +30
 *   • Seller declined or refused declaration    +15
 *   • Items show signs of religious/family use  +10  (cultural context)
 *   • Seller jurisdiction is on high-risk list  +20
 *   • Gold is damaged / melted / unmarked       +10
 *   • Transaction near MoE threshold (AED 50-55K)+15 (structuring signal)
 *   • Seller not previously known               +5
 *
 * The score feeds the brain endpoint as a `manual` event with
 * severity derived from the total.
 *
 * Regulatory: MoE 08/AML/2021 §4, FDL Art.13, Cabinet Res 134/2025
 * Art.14, FATF Typology Report on DPMS 2022.
 */

import { DPMS_CASH_THRESHOLD_AED } from '../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuyBackTransaction {
  id: string;
  at: string; // ISO
  sellerId: string; // customer ref (anonymised — not PII)
  sellerNationality?: string; // ISO alpha-2
  sellerIsNewCustomer: boolean;
  cashPayoutAED: number;
  items: BuyBackItem[];
  hasInvoice: boolean;
  sourceOfGoldDeclared: boolean;
  sourceOfGoldDescription?: string; // max 500 chars
  notes?: string;
}

export interface BuyBackItem {
  description: string;
  declaredPurity?: number; // karat fineness 0..1000
  measuredPurity?: number;
  weightGrams: number;
  condition: 'good' | 'damaged' | 'melted' | 'unmarked' | 'broken';
  likelyReligiousOrFamily: boolean;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface BuyBackRiskAssessment {
  transactionId: string;
  score: number; // 0..200 (cap)
  level: RiskLevel;
  flags: Array<{ code: string; weight: number; detail: string }>;
  recommendation: 'accept' | 'hold_for_review' | 'reject' | 'escalate';
  brainEventPayload: {
    kind: 'manual';
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
    summary: string;
    refId: string;
    meta: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// High-risk seller jurisdictions (gold smuggling / conflict)
// ---------------------------------------------------------------------------

const HIGH_RISK_SELLER_JURISDICTIONS = new Set([
  'CD', // DRC — conflict gold
  'SS', // South Sudan
  'VE', // Venezuela
  'ZW', // Zimbabwe — artisanal sector
  'MM', // Myanmar
  'IR', // Iran — sanctions
  'KP', // DPRK
  'SY', // Syria
]);

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function assessBuyBackRisk(
  tx: BuyBackTransaction,
  historicalTransactions: readonly BuyBackTransaction[] = [],
): BuyBackRiskAssessment {
  const flags: BuyBackRiskAssessment['flags'] = [];
  let score = 0;

  const add = (code: string, weight: number, detail: string): void => {
    flags.push({ code, weight, detail });
    score += weight;
  };

  // 1. No invoice
  if (!tx.hasInvoice) {
    add('NO_INVOICE', 25, 'Transaction has no supporting invoice');
  }

  // 2. Source of gold not declared
  if (!tx.sourceOfGoldDeclared) {
    add('NO_SOURCE_DECLARATION', 15, 'Seller did not declare source of gold');
  }

  // 3. Cash payout above DPMS threshold
  if (tx.cashPayoutAED >= DPMS_CASH_THRESHOLD_AED) {
    add(
      'CASH_ABOVE_THRESHOLD',
      20,
      `Cash payout ${tx.cashPayoutAED.toLocaleString()} AED ≥ ${DPMS_CASH_THRESHOLD_AED.toLocaleString()} DPMS threshold`,
    );
  }

  // 4. Transaction near threshold (structuring signal)
  if (
    tx.cashPayoutAED >= DPMS_CASH_THRESHOLD_AED * 0.9 &&
    tx.cashPayoutAED < DPMS_CASH_THRESHOLD_AED
  ) {
    add(
      'NEAR_THRESHOLD',
      15,
      `Cash payout ${tx.cashPayoutAED.toLocaleString()} AED is within 10% of the reporting threshold (structuring signal)`,
    );
  }

  // 5. Declared vs measured purity mismatch
  for (const item of tx.items) {
    if (
      item.declaredPurity !== undefined &&
      item.measuredPurity !== undefined &&
      Math.abs(item.declaredPurity - item.measuredPurity) > 5
    ) {
      add(
        'PURITY_MISMATCH',
        30,
        `Item "${item.description}": declared ${item.declaredPurity}, measured ${item.measuredPurity} — ${Math.abs(item.declaredPurity - item.measuredPurity).toFixed(0)} ppt off`,
      );
      break; // one flag per transaction
    }
  }

  // 6. Damaged / melted / unmarked items
  const dodgyCount = tx.items.filter(
    (i) => i.condition === 'damaged' || i.condition === 'melted' || i.condition === 'unmarked',
  ).length;
  if (dodgyCount > 0) {
    add(
      'UNMARKED_OR_DAMAGED',
      10,
      `${dodgyCount} item(s) damaged, melted, or unmarked — provenance harder to verify`,
    );
  }

  // 7. Religious / family items (cultural context flag — not inherently
  // suspicious, but warrants additional interview)
  if (tx.items.some((i) => i.likelyReligiousOrFamily)) {
    add(
      'RELIGIOUS_FAMILY_ITEMS',
      10,
      'Items identified as likely religious or family heirlooms — interview seller about context',
    );
  }

  // 8. High-risk seller jurisdiction
  if (
    tx.sellerNationality &&
    HIGH_RISK_SELLER_JURISDICTIONS.has(tx.sellerNationality)
  ) {
    add(
      'HIGH_RISK_JURISDICTION',
      20,
      `Seller nationality ${tx.sellerNationality} is on the high-risk gold-source list`,
    );
  }

  // 9. New customer (not previously known)
  if (tx.sellerIsNewCustomer) {
    add('NEW_CUSTOMER', 5, 'Seller is not in the existing customer database');
  }

  // 10. Repeat seller within 24h
  const txTime = new Date(tx.at).getTime();
  const sameSellerTxs = historicalTransactions.filter(
    (h) => h.sellerId === tx.sellerId && h.id !== tx.id,
  );
  const within24h = sameSellerTxs.filter(
    (h) => Math.abs(new Date(h.at).getTime() - txTime) < 24 * 60 * 60 * 1000,
  );
  if (within24h.length > 0) {
    add(
      'REPEAT_24H',
      20,
      `Seller ${tx.sellerId} has ${within24h.length} other transaction(s) within 24h`,
    );
  }

  // 11. Repeat seller within the same week with different amounts
  const within7d = sameSellerTxs.filter(
    (h) => Math.abs(new Date(h.at).getTime() - txTime) < 7 * 24 * 60 * 60 * 1000,
  );
  if (within24h.length === 0 && within7d.length >= 2) {
    const amounts = new Set(within7d.map((h) => Math.round(h.cashPayoutAED / 1000)));
    if (amounts.size >= 2) {
      add(
        'REPEAT_WEEK_DIVERSE',
        15,
        `Seller ${tx.sellerId} has ${within7d.length} transactions this week with varying amounts`,
      );
    }
  }

  // Cap at 200
  if (score > 200) score = 200;

  // Level classification
  let level: RiskLevel;
  if (score >= 80) level = 'critical';
  else if (score >= 50) level = 'high';
  else if (score >= 25) level = 'medium';
  else level = 'low';

  // Recommendation
  let recommendation: BuyBackRiskAssessment['recommendation'];
  if (score >= 80) recommendation = 'reject';
  else if (score >= 50) recommendation = 'escalate';
  else if (score >= 25) recommendation = 'hold_for_review';
  else recommendation = 'accept';

  // Brain event severity mapping
  const brainSeverity: 'info' | 'low' | 'medium' | 'high' | 'critical' =
    level === 'critical' ? 'critical' : level;

  return {
    transactionId: tx.id,
    score,
    level,
    flags,
    recommendation,
    brainEventPayload: {
      kind: 'manual',
      severity: brainSeverity,
      summary: `Buy-back transaction ${tx.id}: ${level} risk (score ${score}, ${flags.length} flags)`,
      refId: tx.id,
      meta: {
        source: 'buyback-risk-engine',
        sellerId: tx.sellerId,
        cashPayoutAED: tx.cashPayoutAED,
        flagCodes: flags.map((f) => f.code),
        recommendation,
      },
    },
  };
}
