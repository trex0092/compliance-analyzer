/**
 * FATF DPMS Typology Matcher — new brain subsystem.
 *
 * Scores a case feature vector against a library of 25+ named money-
 * laundering typologies drawn from the FATF DPMS Sector reports and
 * UAE MoE Circular 08/AML/2021. Each typology is an explicit set of
 * required + supporting signals with a confidence threshold and a
 * regulatory citation.
 *
 * Why this is needed:
 *   - The weaponized brain already scores risk on a continuous
 *     feature vector, but it does NOT map the result onto NAMED
 *     typologies the MLRO can cite in an STR narrative.
 *   - Regulators expect specific typology labels ("trade-based ML
 *     via over-invoicing", "smurfing via sub-threshold cash deposits",
 *     etc.) not just risk bands.
 *   - This module provides deterministic, explainable typology
 *     matching with full citation so STR narratives can reference
 *     exact FATF guidance paragraphs.
 *
 * Pure function: same input → same output. No network, no state.
 *
 * Regulatory basis:
 *   FATF "Money Laundering and Terrorist Financing Through the
 *        Real Estate Sector"
 *   FATF "ML/TF Through the Physical Transportation of Cash"
 *   FATF "Money Laundering / Terrorist Financing Through Trade
 *        in Diamonds"
 *   FATF "ML/TF Vulnerabilities of Legal Professionals"
 *   FATF Guidance for a Risk-Based Approach — DPMS Sector (2022)
 *   MoE Circular 08/AML/2021 — DPMS red flags
 *   Cabinet Res 134/2025 Art.19 — internal review requires
 *        typology classification
 *   FDL No.10/2025 Art.26-27 — STR narrative must identify the
 *        suspected typology
 */

import type { StrFeatures } from './predictiveStr';
import {
  DPMS_CASH_THRESHOLD_AED,
  CROSS_BORDER_CASH_THRESHOLD_AED,
  ROUND_TRIPPING_THRESHOLD_AED,
} from '../domain/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A weighted predicate that fires on a feature vector. */
export interface TypologySignal {
  /** Human-readable label for explainability. */
  label: string;
  /** Predicate that tests the feature vector. Pure function. */
  test: (f: StrFeatures) => boolean;
  /** Weight contribution when fired. 0..1. */
  weight: number;
  /** Whether this signal is required (all required → 0 match). */
  required: boolean;
}

export interface FatfTypology {
  /** Stable identifier, e.g. 'TBML-001'. */
  id: string;
  /** Short human-readable name. */
  name: string;
  /** One-line description of the typology. */
  description: string;
  /** Required + supporting signals. */
  signals: readonly TypologySignal[];
  /** Minimum score 0..1 for the typology to be considered matching. */
  threshold: number;
  /** Severity band when matched. */
  severity: 'low' | 'medium' | 'high' | 'critical';
  /** Full regulatory citation. */
  regulatory: string;
  /** Recommended action for the MLRO if matched. */
  recommendedAction: string;
}

export interface TypologyMatch {
  typology: FatfTypology;
  /** Score 0..1 — weighted sum of fired signals. */
  score: number;
  /** Labels of signals that fired. */
  firedSignals: readonly string[];
  /** Labels of signals that did not fire (for explainability). */
  missedSignals: readonly string[];
}

export interface TypologyReport {
  /** All matching typologies sorted by score desc. */
  matches: readonly TypologyMatch[];
  /** Top severity across all matches. */
  topSeverity: 'none' | 'low' | 'medium' | 'high' | 'critical';
  /** Human-readable summary for the STR narrative. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Signal helpers (small reusable predicates)
// ---------------------------------------------------------------------------

const sig = {
  pep: (): TypologySignal => ({
    label: 'UBO is PEP',
    test: (f) => f.isPep === true,
    weight: 0.3,
    required: false,
  }),
  highRiskJurisdiction: (): TypologySignal => ({
    label: 'High-risk jurisdiction counterparty',
    test: (f) => f.highRiskJurisdiction === true,
    weight: 0.3,
    required: false,
  }),
  adverseMedia: (): TypologySignal => ({
    label: 'Unresolved adverse media',
    test: (f) => f.hasAdverseMedia === true,
    weight: 0.25,
    required: false,
  }),
  priorAlerts: (n: number): TypologySignal => ({
    label: `${n}+ prior CDD alerts in 90 days`,
    test: (f) => f.priorAlerts90d >= n,
    weight: 0.25,
    required: false,
  }),
  nearThreshold: (n: number): TypologySignal => ({
    label: `${n}+ transactions near AED 55K threshold`,
    test: (f) => f.nearThresholdCount30d >= n,
    weight: 0.35,
    required: false,
  }),
  cashHeavy: (ratio: number): TypologySignal => ({
    label: `Cash ratio >= ${(ratio * 100).toFixed(0)}%`,
    test: (f) => f.cashRatio30d >= ratio,
    weight: 0.3,
    required: false,
  }),
  crossBorderHeavy: (ratio: number): TypologySignal => ({
    label: `Cross-border ratio >= ${(ratio * 100).toFixed(0)}%`,
    test: (f) => f.crossBorderRatio30d >= ratio,
    weight: 0.3,
    required: false,
  }),
  largeTx: (aed: number): TypologySignal => ({
    label: `Tx value >= AED ${aed.toLocaleString()}`,
    test: (f) => f.txValue30dAED >= aed,
    weight: 0.25,
    required: false,
  }),
  sanctionsProximity: (score: number): TypologySignal => ({
    label: `Sanctions proximity >= ${score}`,
    test: (f) => f.sanctionsMatchScore >= score,
    weight: 0.35,
    required: false,
  }),
  newRelationship: (days: number): TypologySignal => ({
    label: `Onboarded within ${days} days`,
    test: (f) => f.daysSinceOnboarding <= days,
    weight: 0.2,
    required: false,
  }),
  required: <T extends TypologySignal>(s: T): T => ({ ...s, required: true }),
};

// ---------------------------------------------------------------------------
// FATF Typology Library (25 typologies)
// ---------------------------------------------------------------------------

export const FATF_TYPOLOGIES: readonly FatfTypology[] = [
  {
    id: 'STRUCT-001',
    name: 'Structuring / Smurfing',
    description:
      'Multiple transactions kept just below the AED 55K reporting threshold to evade CTR obligations.',
    signals: [sig.required(sig.nearThreshold(3)), sig.cashHeavy(0.5)],
    threshold: 0.35,
    severity: 'high',
    regulatory: 'MoE Circular 08/AML/2021; FATF 40+9 Rec.20',
    recommendedAction: 'File CTR + STR; investigate all near-threshold transactions.',
  },
  {
    id: 'TBML-001',
    name: 'Trade-Based ML: Over-Invoicing',
    description:
      'Cross-border trade invoices inflated above market value to transfer extra funds abroad.',
    signals: [
      sig.required(sig.crossBorderHeavy(0.5)),
      sig.largeTx(250_000),
      sig.highRiskJurisdiction(),
    ],
    threshold: 0.4,
    severity: 'high',
    regulatory: 'FATF Trade-Based ML Best Practices 2012; Art.17 FDL',
    recommendedAction: 'Request commercial invoices + compare against market prices.',
  },
  {
    id: 'TBML-002',
    name: 'Trade-Based ML: Under-Invoicing',
    description: 'Cross-border invoices deflated to move undeclared value via shipped goods.',
    signals: [
      sig.required(sig.crossBorderHeavy(0.4)),
      sig.priorAlerts(2),
      sig.highRiskJurisdiction(),
    ],
    threshold: 0.4,
    severity: 'high',
    regulatory: 'FATF Trade-Based ML Best Practices 2012',
    recommendedAction: 'Cross-check shipment manifests against customs declarations.',
  },
  {
    id: 'DPMS-001',
    name: 'High-Value Cash Gold Purchase',
    description: 'Customer walks in and buys gold for large cash amounts with minimal KYC history.',
    signals: [
      sig.required(sig.cashHeavy(0.7)),
      sig.required(sig.largeTx(ROUND_TRIPPING_THRESHOLD_AED)),
      sig.newRelationship(30),
    ],
    threshold: 0.45,
    severity: 'high',
    regulatory: 'MoE Circular 08/AML/2021; FATF DPMS Guidance 2022',
    recommendedAction: 'Trigger Enhanced Due Diligence + source of funds verification.',
  },
  {
    id: 'DPMS-002',
    name: 'Gold for Cash — Repeated Sub-Threshold',
    description: 'Repeated cash gold purchases each under AED 55K to stay below CTR filing duty.',
    signals: [sig.required(sig.nearThreshold(4)), sig.cashHeavy(0.6), sig.priorAlerts(1)],
    threshold: 0.4,
    severity: 'high',
    regulatory: 'MoE Circular 08/AML/2021',
    recommendedAction: 'Aggregate all 30-day transactions + file CTR if combined ≥ 55K.',
  },
  {
    id: 'SANCTIONS-001',
    name: 'Sanctions Proximity Hit',
    description: 'Name or alias proximity to a sanctioned individual / entity.',
    signals: [sig.required(sig.sanctionsProximity(0.5))],
    threshold: 0.35,
    severity: 'critical',
    regulatory: 'FDL Art.35; Cabinet Res 74/2020 Art.4-7',
    recommendedAction: 'Escalate to CO + freeze pending four-eyes review.',
  },
  {
    id: 'SANCTIONS-002',
    name: 'Confirmed Sanctions Match',
    description: 'High-confidence match to a confirmed sanctioned party.',
    signals: [sig.required(sig.sanctionsProximity(0.9))],
    threshold: 0.6,
    severity: 'critical',
    regulatory: 'Cabinet Res 74/2020 Art.4 (24h freeze)',
    recommendedAction: 'Execute freeze protocol immediately + start EOCN countdown.',
  },
  {
    id: 'PEP-001',
    name: 'PEP Onboarding Without EDD',
    description: 'PEP detected but Enhanced Due Diligence not yet completed.',
    signals: [sig.required(sig.pep()), sig.newRelationship(90)],
    threshold: 0.35,
    severity: 'high',
    regulatory: 'Cabinet Res 134/2025 Art.14',
    recommendedAction: 'Trigger EDD + obtain Senior Management approval.',
  },
  {
    id: 'PEP-002',
    name: 'PEP + Cash-Heavy Transactions',
    description: 'PEP customer with disproportionate cash activity for their profile.',
    signals: [sig.required(sig.pep()), sig.required(sig.cashHeavy(0.5))],
    threshold: 0.4,
    severity: 'high',
    regulatory: 'Cabinet Res 134/2025 Art.14; FATF Rec.12',
    recommendedAction: 'Source of funds verification + board-level review.',
  },
  {
    id: 'SHELL-001',
    name: 'Shell-Company Layering',
    description: 'Multiple entities sharing the same UBO used to layer funds across jurisdictions.',
    signals: [
      sig.required(sig.crossBorderHeavy(0.5)),
      sig.newRelationship(60),
      sig.highRiskJurisdiction(),
    ],
    threshold: 0.4,
    severity: 'high',
    regulatory: 'Cabinet Decision 109/2023; FATF Rec.24-25',
    recommendedAction: 'UBO chain traversal + shared-UBO ring check via /cross-case.',
  },
  {
    id: 'CORRIDOR-001',
    name: 'High-Risk Corridor Burst',
    description: 'Sudden spike in transactions to / from a FATF-listed high-risk jurisdiction.',
    signals: [
      sig.required(sig.highRiskJurisdiction()),
      sig.required(sig.crossBorderHeavy(0.6)),
      sig.largeTx(500_000),
    ],
    threshold: 0.45,
    severity: 'high',
    regulatory: 'FATF Rec.19 (high-risk countries)',
    recommendedAction: 'Freeze corridor + escalate to Compliance Officer.',
  },
  {
    id: 'NEW-REL-001',
    name: 'New Relationship — Large First Trade',
    description: 'First-trade amount materially above the profile expected at onboarding.',
    signals: [sig.required(sig.newRelationship(14)), sig.required(sig.largeTx(200_000))],
    threshold: 0.35,
    severity: 'medium',
    regulatory: 'Cabinet Res 134/2025 Art.7-10 (CDD)',
    recommendedAction: 'Apply EDD + source of wealth documentation.',
  },
  {
    id: 'ADVERSE-001',
    name: 'Adverse Media + Cash',
    description: 'Negative news about the customer combined with cash-heavy activity.',
    signals: [sig.required(sig.adverseMedia()), sig.required(sig.cashHeavy(0.4))],
    threshold: 0.4,
    severity: 'high',
    regulatory: 'FATF Rec.10; Cabinet Res 134/2025 Art.14',
    recommendedAction: 'Open STR investigation + escalate to MLRO.',
  },
  {
    id: 'ADVERSE-002',
    name: 'Adverse Media + PEP',
    description: 'Negative news about a politically exposed person.',
    signals: [sig.required(sig.adverseMedia()), sig.required(sig.pep())],
    threshold: 0.4,
    severity: 'critical',
    regulatory: 'Cabinet Res 134/2025 Art.14',
    recommendedAction: 'Board-level approval + full EDD.',
  },
  {
    id: 'REPEAT-ALERT-001',
    name: 'Repeat Alert — Same Customer',
    description: 'Customer has triggered multiple alerts in the past 90 days.',
    signals: [sig.required(sig.priorAlerts(3))],
    threshold: 0.3,
    severity: 'medium',
    regulatory: 'FATF Rec.20',
    recommendedAction: 'Open dedicated investigation; consider relationship exit.',
  },
  {
    id: 'REPEAT-ALERT-002',
    name: 'Persistent Repeat Alerts (5+)',
    description:
      'Customer has triggered 5+ alerts — pattern strongly suggests active ML behaviour.',
    signals: [sig.required(sig.priorAlerts(5))],
    threshold: 0.35,
    severity: 'high',
    regulatory: 'FDL Art.26-27',
    recommendedAction: 'File STR + consider relationship termination.',
  },
  {
    id: 'LARGE-CASH-001',
    name: 'Single Large Cash Transaction',
    description: 'Single cash transaction above AED 55K reporting threshold.',
    signals: [sig.required(sig.cashHeavy(0.5)), sig.required(sig.largeTx(DPMS_CASH_THRESHOLD_AED))],
    threshold: 0.3,
    severity: 'medium',
    regulatory: 'FDL Art.16; MoE Circular 08/AML/2021',
    recommendedAction: 'File CTR within 15 business days; document source of funds.',
  },
  {
    id: 'PF-001',
    name: 'Proliferation Financing Signals',
    description:
      'High-risk jurisdiction + large cross-border trade activity — dual-use goods risk.',
    signals: [
      sig.required(sig.highRiskJurisdiction()),
      sig.required(sig.largeTx(500_000)),
      sig.crossBorderHeavy(0.5),
    ],
    threshold: 0.45,
    severity: 'critical',
    regulatory: 'Cabinet Res 156/2025 (PF + dual-use)',
    recommendedAction: 'Dual-use goods check + end-user verification + EOCN notification.',
  },
  {
    id: 'LAYER-001',
    name: 'Layering via Multiple Small Cross-Border Transfers',
    description: 'Many small cross-border transfers breaking up a larger sum.',
    signals: [sig.required(sig.crossBorderHeavy(0.5)), sig.required(sig.nearThreshold(3))],
    threshold: 0.4,
    severity: 'high',
    regulatory: 'FATF Best Practices on Layering',
    recommendedAction: 'Aggregate related wires + examine for structuring intent.',
  },
  {
    id: 'INTEGRATION-001',
    name: 'Integration — Gold → Cash',
    description:
      'Gold sale with proceeds taken in cash, converting placed funds back to usable currency.',
    signals: [
      sig.required(sig.cashHeavy(0.7)),
      sig.required(sig.largeTx(ROUND_TRIPPING_THRESHOLD_AED)),
    ],
    threshold: 0.4,
    severity: 'high',
    regulatory: 'FATF Three-Stage ML Model; MoE Circular 08/AML/2021',
    recommendedAction: 'Source of gold verification + STR review.',
  },
  {
    id: 'PLACEMENT-001',
    name: 'Placement — Unusual Cash Deposits',
    description: 'Abrupt increase in cash activity for an otherwise cashless customer.',
    signals: [sig.required(sig.cashHeavy(0.5)), sig.required(sig.priorAlerts(1))],
    threshold: 0.35,
    severity: 'medium',
    regulatory: 'FATF Three-Stage ML Model',
    recommendedAction: 'EDD trigger + source of funds verification.',
  },
  {
    id: 'DORMANT-001',
    name: 'Dormancy Reactivation',
    description: 'Long-dormant account reactivated with sudden large activity.',
    signals: [sig.required(sig.priorAlerts(1)), sig.largeTx(200_000)],
    threshold: 0.3,
    severity: 'medium',
    regulatory: 'FATF Rec.20',
    recommendedAction: 'Re-run CDD + verify continued legitimate purpose.',
  },
  {
    id: 'CASH-INTENSIVE-001',
    name: 'Cash-Intensive Business — Unexplained Growth',
    description: 'Cash-intensive customer whose turnover grows beyond declared profile.',
    signals: [
      sig.required(sig.cashHeavy(0.6)),
      sig.required(sig.largeTx(ROUND_TRIPPING_THRESHOLD_AED)),
      sig.priorAlerts(1),
    ],
    threshold: 0.4,
    severity: 'medium',
    regulatory: 'FATF Guidance on Cash-Intensive Businesses',
    recommendedAction: 'Business profile re-assessment + source of income verification.',
  },
  {
    id: 'CROSSBORDER-BNI-001',
    name: 'Cross-Border BNI Above AED 60K',
    description:
      'Cross-border bearer negotiable instrument above the AED 60K declaration threshold.',
    signals: [
      sig.required(sig.crossBorderHeavy(0.4)),
      sig.required(sig.largeTx(CROSS_BORDER_CASH_THRESHOLD_AED)),
    ],
    threshold: 0.3,
    severity: 'high',
    regulatory: 'FDL Art.17',
    recommendedAction: 'File BNI declaration + verify source at border.',
  },
  {
    id: 'SMURFING-CASH-001',
    name: 'Smurfing via Multiple Sub-Threshold Cash Drops',
    description: 'Several cash deposits just below threshold within a short window.',
    signals: [sig.required(sig.nearThreshold(5)), sig.required(sig.cashHeavy(0.7))],
    threshold: 0.45,
    severity: 'high',
    regulatory: 'FATF Best Practices on Structuring',
    recommendedAction: 'Aggregate + file CTR + STR escalation.',
  },
];

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<FatfTypology['severity'], number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Match a feature vector against every FATF typology. Deterministic.
 * Each typology either matches (score >= threshold AND all required
 * signals fired) or not. Matches are returned sorted by score desc.
 */
export function matchFatfTypologies(
  features: StrFeatures,
  library: readonly FatfTypology[] = FATF_TYPOLOGIES
): TypologyReport {
  const matches: TypologyMatch[] = [];

  for (const typology of library) {
    let score = 0;
    let totalWeight = 0;
    const fired: string[] = [];
    const missed: string[] = [];
    let allRequiredFired = true;

    for (const signal of typology.signals) {
      totalWeight += signal.weight;
      if (signal.test(features)) {
        score += signal.weight;
        fired.push(signal.label);
      } else {
        missed.push(signal.label);
        if (signal.required) allRequiredFired = false;
      }
    }

    const normalisedScore = totalWeight > 0 ? score / totalWeight : 0;
    if (allRequiredFired && normalisedScore >= typology.threshold) {
      matches.push({
        typology,
        score: normalisedScore,
        firedSignals: fired,
        missedSignals: missed,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  let topSeverity: TypologyReport['topSeverity'] = 'none';
  let topRank = 0;
  for (const m of matches) {
    const r = SEVERITY_RANK[m.typology.severity];
    if (r > topRank) {
      topRank = r;
      topSeverity = m.typology.severity;
    }
  }

  const summary =
    matches.length === 0
      ? 'No FATF typologies matched for this case.'
      : `Matched ${matches.length} FATF typolog${matches.length === 1 ? 'y' : 'ies'}; top severity ${topSeverity}. Leading match: ${matches[0].typology.name} (${matches[0].typology.id}).`;

  return { matches, topSeverity, summary };
}

// Exports for tests.
export const __test__ = { SEVERITY_RANK, sig };
