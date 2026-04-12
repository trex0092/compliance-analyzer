/**
 * Trade-Based Money Laundering (TBML) Detector
 *
 * Detects over/under-invoicing, phantom trades, round-trip transactions
 * and commodity price manipulation in gold supply chains.
 *
 * Regulatory: FATF Guidance on TBML (2006, updated 2020), FDL No.10/2025
 *             Art.12-14 (CDD), Cabinet Res 134/2025 Art.7-10, LBMA RGG v9,
 *             OECD DDG 2016 §3, UAE MoE Circular 08/AML/2021.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type TbmlRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type TbmlPatternType =
  | 'over_invoicing'
  | 'under_invoicing'
  | 'phantom_shipment'
  | 'round_trip'
  | 'multiple_invoicing'
  | 'commodity_substitution'
  | 'price_manipulation'
  | 'shell_company_routing'
  | 'unusual_payment_terms'
  | 'document_inconsistency';

export interface TradeDocument {
  documentId: string;
  type: 'invoice' | 'bill_of_lading' | 'packing_list' | 'certificate_of_origin' | 'assay_cert' | 'customs_declaration';
  invoicedValue_AED: number;
  declaredValue_AED?: number;         // customs-declared value
  weightTroyOz: number;
  counterpartyId: string;
  originCountry: string;
  destinationCountry: string;
  transactionDate: string;
  paymentTermsDays?: number;
  relatedDocumentIds?: string[];
}

export interface MarketBenchmark {
  date: string;
  spotPriceAED_perTroyOz: number;     // CBUAE published rate × LBMA fix
  fineness: number;                   // 0.999, 0.995, 0.916 etc.
}

export interface TbmlTransaction {
  transactionId: string;
  documents: TradeDocument[];
  benchmark: MarketBenchmark;
  counterpartyId: string;
  counterpartyJurisdiction: string;
  relatedPartyTransaction: boolean;
  priorRelationshipMonths?: number;
}

export interface TbmlPattern {
  type: TbmlPatternType;
  severity: TbmlRiskLevel;
  confidence: number;                 // 0–1
  description: string;
  evidenceFields: string[];
  regulatoryRef: string;
}

export interface TbmlAssessment {
  transactionId: string;
  generatedAt: string;
  overallRisk: TbmlRiskLevel;
  compositeScore: number;             // 0–100
  patterns: TbmlPattern[];
  priceDeviationPct: number;          // % from benchmark
  invoicingAnomaly: boolean;
  phantomIndicators: string[];
  roundTripIndicators: string[];
  requiresCdd: boolean;
  requiresEdd: boolean;
  requiresStr: boolean;
  narrativeSummary: string;
  regulatoryRefs: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** FATF TBML: >10% over/under benchmark is a material deviation */
const PRICE_DEVIATION_THRESHOLD_PCT = 10;
/** >25% is a strong indicator of deliberate manipulation */
const PRICE_DEVIATION_CRITICAL_PCT = 25;
/** Unusually long payment terms (>90 days) for a commodity trade */
const LONG_PAYMENT_TERMS_DAYS = 90;
/** Multiple invoices for same goods: >2 for same document chain */
const MULTI_INVOICE_THRESHOLD = 2;

// ─── Detection Functions ──────────────────────────────────────────────────────

function detectPriceManipulation(tx: TbmlTransaction): TbmlPattern | null {
  const totalInvoiced = tx.documents
    .filter(d => d.type === 'invoice')
    .reduce((s, d) => s + d.invoicedValue_AED, 0);
  const totalWeight = tx.documents
    .filter(d => d.type === 'invoice')
    .reduce((s, d) => s + d.weightTroyOz, 0);

  if (totalWeight === 0) return null;

  const invoicedPricePerOz = totalInvoiced / totalWeight;
  const benchmarkPrice = tx.benchmark.spotPriceAED_perTroyOz * tx.benchmark.fineness;
  const deviationPct = ((invoicedPricePerOz - benchmarkPrice) / benchmarkPrice) * 100;

  if (Math.abs(deviationPct) < PRICE_DEVIATION_THRESHOLD_PCT) return null;

  const type: TbmlPatternType = deviationPct > 0 ? 'over_invoicing' : 'under_invoicing';
  const severity: TbmlRiskLevel = Math.abs(deviationPct) >= PRICE_DEVIATION_CRITICAL_PCT ? 'critical' : 'high';

  return {
    type,
    severity,
    confidence: Math.min(1, Math.abs(deviationPct) / 50),
    description: `Invoiced price ${invoicedPricePerOz.toFixed(0)} AED/oz deviates ${deviationPct.toFixed(1)}% from LBMA benchmark ${benchmarkPrice.toFixed(0)} AED/oz`,
    evidenceFields: ['invoicedValue_AED', 'benchmark.spotPriceAED_perTroyOz'],
    regulatoryRef: 'FATF TBML Guidance 2020 §3.1; FDL No.10/2025 Art.12',
  };
}

function detectPhantomShipment(tx: TbmlTransaction): TbmlPattern | null {
  const invoices = tx.documents.filter(d => d.type === 'invoice');
  const billsOfLading = tx.documents.filter(d => d.type === 'bill_of_lading');
  const assayCerts = tx.documents.filter(d => d.type === 'assay_cert');

  const indicators: string[] = [];

  if (invoices.length > 0 && billsOfLading.length === 0) {
    indicators.push('Invoice without bill of lading — no shipping evidence');
  }
  if (invoices.length > 0 && assayCerts.length === 0) {
    indicators.push('Invoice without assay certificate — no product verification');
  }

  const totalInvoicedWeight = invoices.reduce((s, d) => s + d.weightTroyOz, 0);
  const totalBLWeight = billsOfLading.reduce((s, d) => s + d.weightTroyOz, 0);
  if (totalInvoicedWeight > 0 && totalBLWeight > 0) {
    const diff = Math.abs(totalInvoicedWeight - totalBLWeight) / totalInvoicedWeight;
    if (diff > 0.05) indicators.push(`Weight discrepancy: invoice ${totalInvoicedWeight.toFixed(2)}oz vs BL ${totalBLWeight.toFixed(2)}oz (${(diff*100).toFixed(1)}%)`);
  }

  if (indicators.length === 0) return null;

  return {
    type: 'phantom_shipment',
    severity: indicators.length >= 2 ? 'critical' : 'high',
    confidence: Math.min(1, indicators.length * 0.35),
    description: `Phantom shipment indicators: ${indicators.join('; ')}`,
    evidenceFields: ['documents'],
    regulatoryRef: 'FATF TBML Guidance 2020 §3.2; LBMA RGG v9 §4',
  };
}

function detectRoundTrip(tx: TbmlTransaction): TbmlPattern | null {
  const originCountries = new Set(tx.documents.map(d => d.originCountry));
  const destCountries = new Set(tx.documents.map(d => d.destinationCountry));

  // Round-trip: commodity flows A→B→A, or A→B→C and then C→A in related docs
  const overlap = [...originCountries].filter(c => destCountries.has(c));
  if (overlap.length === 0) return null;

  return {
    type: 'round_trip',
    severity: 'high',
    confidence: 0.65,
    description: `Round-trip routing detected: countries appear as both origin and destination (${overlap.join(', ')})`,
    evidenceFields: ['originCountry', 'destinationCountry'],
    regulatoryRef: 'FATF TBML Guidance 2020 §3.3; Cabinet Res 134/2025 Art.7',
  };
}

function detectMultipleInvoicing(tx: TbmlTransaction): TbmlPattern | null {
  const invoices = tx.documents.filter(d => d.type === 'invoice');
  if (invoices.length <= MULTI_INVOICE_THRESHOLD) return null;

  const totalInvoicedWeight = invoices.reduce((s, d) => s + d.weightTroyOz, 0);
  const maxSingleWeight = Math.max(...invoices.map(d => d.weightTroyOz));

  if (totalInvoicedWeight > maxSingleWeight * MULTI_INVOICE_THRESHOLD) {
    return {
      type: 'multiple_invoicing',
      severity: 'high',
      confidence: 0.72,
      description: `${invoices.length} invoices for same transaction totalling ${totalInvoicedWeight.toFixed(2)} oz — possible double-invoicing`,
      evidenceFields: ['documents'],
      regulatoryRef: 'FATF TBML Guidance 2020 §3.4; FDL No.10/2025 Art.13',
    };
  }

  return null;
}

function detectUnusualPaymentTerms(tx: TbmlTransaction): TbmlPattern | null {
  const longTermDocs = tx.documents.filter(
    d => d.paymentTermsDays !== null && d.paymentTermsDays !== undefined && d.paymentTermsDays > LONG_PAYMENT_TERMS_DAYS,
  );
  if (longTermDocs.length === 0) return null;

  const maxTerms = Math.max(...longTermDocs.map(d => d.paymentTermsDays!));
  return {
    type: 'unusual_payment_terms',
    severity: maxTerms > 180 ? 'high' : 'medium',
    confidence: 0.55,
    description: `Payment terms of ${maxTerms} days exceed ${LONG_PAYMENT_TERMS_DAYS}-day DPMS commodity norm`,
    evidenceFields: ['paymentTermsDays'],
    regulatoryRef: 'FATF TBML Guidance 2020 §2.3; MoE Circular 08/AML/2021',
  };
}

function detectDocumentInconsistency(tx: TbmlTransaction): TbmlPattern | null {
  const invoices = tx.documents.filter(d => d.type === 'invoice');
  const customs = tx.documents.filter(d => d.type === 'customs_declaration');

  const inconsistencies: string[] = [];
  for (const inv of invoices) {
    const matchingCustoms = customs.find(c => c.counterpartyId === inv.counterpartyId);
    if (matchingCustoms && matchingCustoms.declaredValue_AED !== null && matchingCustoms.declaredValue_AED !== undefined) {
      const diff = Math.abs(inv.invoicedValue_AED - matchingCustoms.declaredValue_AED) / inv.invoicedValue_AED;
      if (diff > 0.05) {
        inconsistencies.push(`Invoice ${inv.documentId}: AED ${inv.invoicedValue_AED.toLocaleString()} vs customs AED ${matchingCustoms.declaredValue_AED.toLocaleString()} (${(diff*100).toFixed(1)}% diff)`);
      }
    }
  }

  if (inconsistencies.length === 0) return null;

  return {
    type: 'document_inconsistency',
    severity: inconsistencies.length >= 2 ? 'critical' : 'high',
    confidence: Math.min(1, 0.5 + inconsistencies.length * 0.2),
    description: `Invoice-to-customs value mismatches detected: ${inconsistencies.join('; ')}`,
    evidenceFields: ['invoicedValue_AED', 'declaredValue_AED'],
    regulatoryRef: 'FATF TBML Guidance 2020 §3.1; Cabinet Res 134/2025 Art.9; UAE Customs Law',
  };
}

function deriveRisk(score: number): TbmlRiskLevel {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function detectTbml(tx: TbmlTransaction): TbmlAssessment {
  const detectors = [
    detectPriceManipulation,
    detectPhantomShipment,
    detectRoundTrip,
    detectMultipleInvoicing,
    detectUnusualPaymentTerms,
    detectDocumentInconsistency,
  ];

  const patterns = detectors
    .map(fn => fn(tx))
    .filter((p): p is TbmlPattern => p !== null);

  // Composite risk score
  const severityWeights: Record<TbmlRiskLevel, number> = { critical: 40, high: 25, medium: 15, low: 5 };
  const compositeScore = Math.min(100, patterns.reduce((s, p) => s + severityWeights[p.severity] * p.confidence, 0));
  const overallRisk = deriveRisk(compositeScore);

  // Related-party uplift
  const adjustedScore = tx.relatedPartyTransaction ? Math.min(100, compositeScore + 15) : compositeScore;

  const invoices = tx.documents.filter(d => d.type === 'invoice');
  const totalWeight = invoices.reduce((s, d) => s + d.weightTroyOz, 0);
  const totalInvoiced = invoices.reduce((s, d) => s + d.invoicedValue_AED, 0);
  const invoicedPPO = totalWeight > 0 ? totalInvoiced / totalWeight : 0;
  const benchmarkPPO = tx.benchmark.spotPriceAED_perTroyOz * tx.benchmark.fineness;
  const priceDeviationPct = benchmarkPPO > 0 ? ((invoicedPPO - benchmarkPPO) / benchmarkPPO) * 100 : 0;

  const phantomIndicators = patterns
    .filter(p => p.type === 'phantom_shipment')
    .flatMap(p => p.evidenceFields);

  const roundTripIndicators = patterns
    .filter(p => p.type === 'round_trip')
    .map(p => p.description);

  const requiresCdd = adjustedScore >= 25;
  const requiresEdd = adjustedScore >= 50;
  const requiresStr = adjustedScore >= 75 || patterns.some(p => p.severity === 'critical');

  const narrativeSummary =
    `Transaction ${tx.transactionId}: TBML composite score ${adjustedScore.toFixed(0)}/100 ` +
    `(${overallRisk.toUpperCase()}). ${patterns.length} pattern(s) detected: ` +
    `${patterns.map(p => p.type.replace('_', ' ')).join(', ') || 'none'}. ` +
    `Price deviation: ${priceDeviationPct.toFixed(1)}% from LBMA benchmark. ` +
    `STR required: ${requiresStr}. EDD required: ${requiresEdd}.`;

  return {
    transactionId: tx.transactionId,
    generatedAt: new Date().toISOString(),
    overallRisk,
    compositeScore: adjustedScore,
    patterns,
    priceDeviationPct,
    invoicingAnomaly: patterns.some(p => ['over_invoicing', 'under_invoicing', 'multiple_invoicing'].includes(p.type)),
    phantomIndicators,
    roundTripIndicators,
    requiresCdd,
    requiresEdd,
    requiresStr,
    narrativeSummary,
    regulatoryRefs: [
      'FATF Guidance on Trade-Based Money Laundering (2006, updated 2020)',
      'FDL No.10/2025 Art.12-14 — Customer Due Diligence',
      'Cabinet Res 134/2025 Art.7-10 — CDD Tiers',
      'LBMA Responsible Gold Guidance v9 §4',
      'OECD DDG 2016 Step 3 — Supply chain due diligence',
      'UAE MoE Circular 08/AML/2021',
      'FATF Rec 22/23 — DPMS Sector Obligations',
    ],
  };
}
