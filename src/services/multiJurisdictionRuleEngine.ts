/**
 * Multi-Jurisdictional Rule Engine — evaluate UAE + EU + UK + US AML
 * rules simultaneously and surface the strictest applicable rule per
 * dimension.
 *
 * Why this exists:
 *   The brain is UAE-first (FDL No.10/2025, Cabinet Resolutions, MoE
 *   Circulars). For UAE DPMS firms with EU / UK / US customers,
 *   applying only UAE rules creates a regulatory gap: the home-
 *   jurisdiction rules of the customer often impose STRICTER limits
 *   (e.g. EU 6AMLD beneficial ownership = 25% UNLESS local law goes
 *   lower; UK MLR 2017 caps cash transactions at GBP 10,000;
 *   US BSA CTR is USD 10,000).
 *
 *   This module is the cross-jurisdictional projector. Given a
 *   customer + a transaction, it walks the applicable jurisdictions
 *   and returns the EFFECTIVE rule per dimension (cash threshold,
 *   UBO threshold, retention, STR deadline) — always picking the
 *   strictest. The brain consumes this to decide whether the firm
 *   is meeting the customer's home-jurisdiction obligations on top
 *   of UAE obligations.
 *
 *   Pure function. No I/O. Same input → same output.
 *
 * Design constraint:
 *   We embed a small static rule table (UAE / EU / UK / US) here
 *   instead of importing constants.ts. This keeps the cross-
 *   jurisdictional rule independent of the UAE constants version
 *   and makes audits cleaner — auditors see exactly which foreign
 *   rule values we used.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12-14 (CDD scaled to customer risk)
 *   FATF Rec 19              (higher-risk countries)
 *   FATF Rec 22              (DPMS sector)
 *   EU 6AMLD                 (Sixth AML Directive)
 *   UK MLR 2017              (Money Laundering Regulations 2017)
 *   US BSA + FinCEN          (Bank Secrecy Act + FinCEN reporting)
 *   NIST AI RMF 1.0 GOVERN-1 (jurisdictional process boundary)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Jurisdiction = 'UAE' | 'EU' | 'UK' | 'US';

export type RuleDimension =
  | 'cash_transaction_threshold_aed'
  | 'cross_border_threshold_aed'
  | 'ubo_ownership_pct'
  | 'record_retention_years'
  | 'str_filing_deadline_days'
  | 'cnmr_or_equivalent_days';

export interface JurisdictionRule {
  jurisdiction: Jurisdiction;
  /** Rule value in the canonical unit shown by the dimension key. */
  value: number;
  /** Brief citation. */
  citation: string;
  /**
   * "lower-is-stricter" for thresholds (smaller number = harder
   * trigger), "higher-is-stricter" for retention (more years =
   * stricter), "lower-is-stricter" for deadlines (less time = stricter).
   */
  strictnessDirection: 'lower' | 'higher';
}

export interface DimensionResult {
  dimension: RuleDimension;
  /** Every applicable jurisdiction rule. */
  rules: readonly JurisdictionRule[];
  /** Strictest rule across the applicable jurisdictions. */
  effective: JurisdictionRule;
  /** Plain-English summary. */
  finding: string;
}

export interface MultiJurisdictionReport {
  schemaVersion: 1;
  applicableJurisdictions: readonly Jurisdiction[];
  results: readonly DimensionResult[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Static rule table (USD/AED/GBP normalised to AED via stable peg)
// ---------------------------------------------------------------------------

/**
 * Reference FX. Keep this CONSERVATIVE (favouring stricter rule
 * application) and refresh quarterly. These are NOT the live CBUAE
 * rates — they are deliberately rounded down so the converted
 * threshold is always the smaller, stricter number.
 */
const FX_TO_AED = {
  USD: 3.6725, // CBUAE peg
  GBP: 4.5, // conservative (real rate ~4.6+)
  EUR: 3.9, // conservative
};

const RULE_TABLE: Readonly<
  Record<
    Jurisdiction,
    ReadonlyArray<{
      dimension: RuleDimension;
      value: number;
      citation: string;
      strictnessDirection: 'lower' | 'higher';
    }>
  >
> = {
  UAE: [
    {
      dimension: 'cash_transaction_threshold_aed',
      value: 55_000,
      citation: 'FDL Art.16; MoE Circular 08/AML/2021',
      strictnessDirection: 'lower',
    },
    {
      dimension: 'cross_border_threshold_aed',
      value: 60_000,
      citation: 'FDL Art.17; Cabinet Res 134/2025 Art.16',
      strictnessDirection: 'lower',
    },
    {
      dimension: 'ubo_ownership_pct',
      value: 25,
      citation: 'Cabinet Decision 109/2023',
      strictnessDirection: 'lower',
    },
    {
      dimension: 'record_retention_years',
      value: 10,
      citation: 'FDL No.10/2025 Art.24',
      strictnessDirection: 'higher',
    },
    {
      dimension: 'str_filing_deadline_days',
      value: 0, // "without delay"
      citation: 'FDL No.10/2025 Art.26-27',
      strictnessDirection: 'lower',
    },
    {
      dimension: 'cnmr_or_equivalent_days',
      value: 5,
      citation: 'Cabinet Res 74/2020 Art.6',
      strictnessDirection: 'lower',
    },
  ],
  EU: [
    {
      dimension: 'cash_transaction_threshold_aed',
      value: 10_000 * FX_TO_AED.EUR, // EUR 10K AMLR cash limit
      citation: 'EU AMLR (Reg 2024/1624) Art.59 — €10,000 cash limit',
      strictnessDirection: 'lower',
    },
    {
      dimension: 'ubo_ownership_pct',
      value: 25,
      citation: '4AMLD Art.3(6) — 25% beneficial owner threshold',
      strictnessDirection: 'lower',
    },
    {
      dimension: 'record_retention_years',
      value: 5,
      citation: '4AMLD Art.40 — 5 year minimum',
      strictnessDirection: 'higher',
    },
    {
      dimension: 'str_filing_deadline_days',
      value: 0, // "promptly"
      citation: '4AMLD Art.33(1) — file promptly',
      strictnessDirection: 'lower',
    },
  ],
  UK: [
    {
      dimension: 'cash_transaction_threshold_aed',
      // UK High Value Dealer threshold is EUR 10,000 (≈ GBP 8,500 ≈ AED 38K).
      value: 10_000 * FX_TO_AED.EUR,
      citation: 'UK MLR 2017 Reg 14 — €10,000 HVD threshold',
      strictnessDirection: 'lower',
    },
    {
      dimension: 'ubo_ownership_pct',
      value: 25,
      citation: 'UK MLR 2017 Reg 6 — 25% beneficial owner',
      strictnessDirection: 'lower',
    },
    {
      dimension: 'record_retention_years',
      value: 5,
      citation: 'UK MLR 2017 Reg 40 — 5 year minimum',
      strictnessDirection: 'higher',
    },
    {
      dimension: 'str_filing_deadline_days',
      value: 0,
      citation: 'UK POCA 2002 s330 — file as soon as practicable',
      strictnessDirection: 'lower',
    },
  ],
  US: [
    {
      dimension: 'cash_transaction_threshold_aed',
      value: 10_000 * FX_TO_AED.USD, // USD 10K BSA CTR
      citation: 'US BSA 31 USC §5313 — $10,000 CTR threshold',
      strictnessDirection: 'lower',
    },
    {
      dimension: 'ubo_ownership_pct',
      value: 25,
      citation: 'US CTA / FinCEN Final Rule §1010.380 — 25% beneficial owner',
      strictnessDirection: 'lower',
    },
    {
      dimension: 'record_retention_years',
      value: 5,
      citation: 'US BSA 31 CFR §1010.430 — 5 year minimum',
      strictnessDirection: 'higher',
    },
    {
      dimension: 'str_filing_deadline_days',
      value: 30, // SAR deadline
      citation: 'US BSA 31 CFR §1020.320 — SAR within 30 days',
      strictnessDirection: 'lower',
    },
  ],
};

const ALL_DIMENSIONS: readonly RuleDimension[] = [
  'cash_transaction_threshold_aed',
  'cross_border_threshold_aed',
  'ubo_ownership_pct',
  'record_retention_years',
  'str_filing_deadline_days',
  'cnmr_or_equivalent_days',
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CrossJurisdictionInput {
  /** ISO country codes the customer touches. */
  customerJurisdictions: readonly string[];
}

/**
 * Map a country code to one of our four jurisdictional families.
 * Anything not explicitly supported maps to UAE (the home regime)
 * so we never under-apply.
 */
export function jurisdictionFor(countryCode: string): Jurisdiction {
  const cc = countryCode.toUpperCase();
  if (cc === 'AE') return 'UAE';
  if (cc === 'GB' || cc === 'UK') return 'UK';
  if (cc === 'US') return 'US';
  // EU member states
  const EU_CODES = new Set([
    'AT',
    'BE',
    'BG',
    'HR',
    'CY',
    'CZ',
    'DK',
    'EE',
    'FI',
    'FR',
    'DE',
    'GR',
    'HU',
    'IE',
    'IT',
    'LV',
    'LT',
    'LU',
    'MT',
    'NL',
    'PL',
    'PT',
    'RO',
    'SK',
    'SI',
    'ES',
    'SE',
  ]);
  if (EU_CODES.has(cc)) return 'EU';
  return 'UAE';
}

function pickStrictest(rules: readonly JurisdictionRule[]): JurisdictionRule {
  let best = rules[0]!;
  for (const r of rules.slice(1)) {
    if (r.strictnessDirection === 'lower') {
      if (r.value < best.value) best = r;
    } else if (r.strictnessDirection === 'higher') {
      if (r.value > best.value) best = r;
    }
  }
  return best;
}

export function evaluateMultiJurisdiction(input: CrossJurisdictionInput): MultiJurisdictionReport {
  // Always include UAE — the home regime — even if the customer
  // is purely foreign. UAE law applies to UAE-resident DPMS firms.
  const applicable = new Set<Jurisdiction>(['UAE']);
  for (const cc of input.customerJurisdictions) {
    applicable.add(jurisdictionFor(cc));
  }

  const applicableArr = Array.from(applicable).sort() as Jurisdiction[];

  const results: DimensionResult[] = [];
  for (const dim of ALL_DIMENSIONS) {
    const rules: JurisdictionRule[] = [];
    for (const j of applicableArr) {
      const tableRow = RULE_TABLE[j].find((r) => r.dimension === dim);
      if (!tableRow) continue;
      rules.push({
        jurisdiction: j,
        value: tableRow.value,
        citation: tableRow.citation,
        strictnessDirection: tableRow.strictnessDirection,
      });
    }
    if (rules.length === 0) continue;
    const effective = pickStrictest(rules);
    const finding =
      `${dim}: strictest applicable rule is ${effective.value} ` +
      `(${effective.jurisdiction}). ${effective.citation}.`;
    results.push({ dimension: dim, rules, effective, finding });
  }

  const summary =
    `Evaluated ${results.length} dimension(s) across ${applicableArr.length} ` +
    `jurisdiction(s) (${applicableArr.join(', ')}). ` +
    `Strictest rules surfaced for institutional adoption.`;

  return {
    schemaVersion: 1,
    applicableJurisdictions: applicableArr,
    results,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.12-14',
      'FATF Rec 19',
      'FATF Rec 22',
      'EU 6AMLD',
      'UK MLR 2017',
      'US BSA + FinCEN CTA',
      'NIST AI RMF 1.0 GOVERN-1',
    ],
  };
}

// Exports for tests.
export const __test__ = { jurisdictionFor, pickStrictest, RULE_TABLE, FX_TO_AED };
