/**
 * Investment Gold VAT Engine — UAE VAT Decree-Law 8/2017.
 *
 * UAE VAT treats "investment gold" as zero-rated but everything else
 * (jewellery, scrap, industrial) at 5%. The engine:
 *
 *   1. Classifies each transaction line as investment or not
 *      (delegates to classifyInvestmentGold from fineness.ts)
 *   2. Computes VAT due at the correct rate
 *   3. Detects VAT carousel / missing-trader fraud patterns
 *
 * Carousel fraud pattern (a.k.a. MTIC — Missing Trader Intra-Community):
 *   Company A buys VAT-free (investment gold) from outside UAE
 *   Company A sells to Company B charging 5% VAT (mis-classified as
 *     jewellery / scrap)
 *   Company A never remits the VAT to the Federal Tax Authority
 *   Company B claims the 5% as input VAT credit
 *   Net effect: the fraudster pockets the 5% and disappears
 *
 * Detection signals:
 *   - Same seller appears in many VAT-charged gold sales over a
 *     short window (scale without established history)
 *   - VAT rate mismatch — investment-grade bullion sold with 5% VAT
 *   - Circular trade (A → B → C → A) on the same gold
 *   - Round-number VAT amounts in bulk transactions
 *   - Seller is a new entity with short history
 *
 * Regulatory: UAE VAT Decree-Law 8/2017 Art.36, UAE Federal Tax
 * Authority Guide on Gold, FATF DPMS Typologies 2022.
 */

import { classifyInvestmentGold } from './fineness';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoldSaleLine {
  lineId: string;
  form: 'bar' | 'ingot' | 'wafer' | 'coin' | 'jewellery' | 'scrap' | 'industrial';
  fineness: number;
  isLegalTender?: boolean;
  quantityUnits: number;
  unitPriceAED: number;
  declaredVatRate: number; // as decimal, e.g. 0 or 0.05
}

export interface GoldSale {
  transactionId: string;
  at: string;
  sellerId: string;
  buyerId: string;
  sellerEstablishedDate?: string;
  lines: GoldSaleLine[];
}

export interface VatAssessment {
  lineId: string;
  isInvestmentGold: boolean;
  expectedVatRate: 0 | 0.05;
  declaredVatRate: number;
  lineValue: number;
  expectedVat: number;
  declaredVat: number;
  vatDiscrepancy: number; // expected - declared
  classification: string;
}

export interface SaleVatReport {
  transactionId: string;
  lines: VatAssessment[];
  totalValue: number;
  totalExpectedVat: number;
  totalDeclaredVat: number;
  totalDiscrepancy: number;
  misclassifiedLines: number;
  hasCarouselSignals: boolean;
  carouselSignals: string[];
}

// ---------------------------------------------------------------------------
// Per-sale assessment
// ---------------------------------------------------------------------------

export function assessSaleVat(sale: GoldSale): SaleVatReport {
  const assessments: VatAssessment[] = [];
  const carouselSignals: string[] = [];

  let totalValue = 0;
  let totalExpected = 0;
  let totalDeclared = 0;
  let misclassified = 0;

  for (const line of sale.lines) {
    const classification = classifyInvestmentGold({
      fineness: line.fineness,
      form: line.form,
      isLegalTender: line.isLegalTender,
    });

    const lineValue = line.quantityUnits * line.unitPriceAED;
    const expectedVat = lineValue * classification.vatRate;
    const declaredVat = lineValue * line.declaredVatRate;
    const discrepancy = expectedVat - declaredVat;

    if (Math.abs(classification.vatRate - line.declaredVatRate) > 0.0001) {
      misclassified++;
    }

    assessments.push({
      lineId: line.lineId,
      isInvestmentGold: classification.isInvestmentGold,
      expectedVatRate: classification.vatRate,
      declaredVatRate: line.declaredVatRate,
      lineValue,
      expectedVat,
      declaredVat,
      vatDiscrepancy: discrepancy,
      classification: classification.reason,
    });

    totalValue += lineValue;
    totalExpected += expectedVat;
    totalDeclared += declaredVat;
  }

  // Carousel detection signals (per-sale, stateless)
  // 1. Investment-grade bullion sold with 5% VAT → possible misclassification
  const investmentGradeWithVat = assessments.filter(
    (a) => a.isInvestmentGold && a.declaredVatRate > 0
  );
  if (investmentGradeWithVat.length > 0) {
    carouselSignals.push(
      `${investmentGradeWithVat.length} investment-grade line(s) declared with 5% VAT — zero-rate expected`
    );
  }

  // 2. Newly-established seller handling high-value transaction
  if (sale.sellerEstablishedDate) {
    const ageMs = new Date(sale.at).getTime() - new Date(sale.sellerEstablishedDate).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    if (ageDays < 180 && totalValue >= 500_000) {
      carouselSignals.push(
        `Seller established only ${ageDays.toFixed(0)} days ago with ${totalValue.toLocaleString()} AED transaction — new-entity red flag`
      );
    }
  }

  // 3. Round-number VAT suggests scripted declaration
  const roundVatLines = assessments.filter(
    (a) => a.declaredVat > 0 && a.declaredVat % 1000 === 0
  ).length;
  if (roundVatLines >= 3 && assessments.length >= 3) {
    carouselSignals.push(
      `${roundVatLines}/${assessments.length} line(s) have round-number VAT amounts — scripted declaration signal`
    );
  }

  return {
    transactionId: sale.transactionId,
    lines: assessments,
    totalValue,
    totalExpectedVat: Math.round(totalExpected * 100) / 100,
    totalDeclaredVat: Math.round(totalDeclared * 100) / 100,
    totalDiscrepancy: Math.round((totalExpected - totalDeclared) * 100) / 100,
    misclassifiedLines: misclassified,
    hasCarouselSignals: carouselSignals.length > 0,
    carouselSignals,
  };
}

// ---------------------------------------------------------------------------
// Cross-sale carousel / circular trade detection
// ---------------------------------------------------------------------------

export interface CircularTrade {
  path: string[]; // entity ids in the cycle
  totalValue: number;
  hops: number;
}

/**
 * Detect circular trades across a set of sales — e.g. A sells to B
 * sells to C sells back to A on the same gold within a short window.
 *
 * Simplified: groups sales by value within a tolerance and looks for
 * entity cycles. Real-world detection needs a graph database; this
 * is sufficient for a batch-scan over a day's transactions.
 */
export function detectCircularTrades(
  sales: readonly GoldSale[],
  windowHours = 48,
  valueTolerancePct = 0.05
): CircularTrade[] {
  const out: CircularTrade[] = [];
  const windowMs = windowHours * 60 * 60 * 1000;

  // Bucket sales by approximate value
  const buckets = new Map<string, GoldSale[]>();
  for (const sale of sales) {
    const value = sale.lines.reduce((s, l) => s + l.quantityUnits * l.unitPriceAED, 0);
    const bucket = Math.round(value / (value * valueTolerancePct || 1)).toString();
    const list = buckets.get(bucket) ?? [];
    list.push(sale);
    buckets.set(bucket, list);
  }

  // Walk each bucket looking for A→B, B→C, C→A chains
  for (const [, bucket] of buckets) {
    if (bucket.length < 3) continue;
    bucket.sort((a, b) => a.at.localeCompare(b.at));

    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i];
        const b = bucket[j];
        // Must chain: a.buyer === b.seller
        if (a.buyerId !== b.sellerId) continue;
        const timeDiff = new Date(b.at).getTime() - new Date(a.at).getTime();
        if (timeDiff < 0 || timeDiff > windowMs) continue;
        for (let k = j + 1; k < bucket.length; k++) {
          const c = bucket[k];
          if (b.buyerId !== c.sellerId) continue;
          if (c.buyerId !== a.sellerId) continue;
          const totalTime = new Date(c.at).getTime() - new Date(a.at).getTime();
          if (totalTime > windowMs) continue;
          const totalValue =
            a.lines.reduce((s, l) => s + l.quantityUnits * l.unitPriceAED, 0) +
            b.lines.reduce((s, l) => s + l.quantityUnits * l.unitPriceAED, 0) +
            c.lines.reduce((s, l) => s + l.quantityUnits * l.unitPriceAED, 0);
          out.push({
            path: [a.sellerId, b.sellerId, c.sellerId, a.sellerId],
            totalValue,
            hops: 3,
          });
        }
      }
    }
  }
  return out;
}
