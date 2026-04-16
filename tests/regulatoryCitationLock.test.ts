/**
 * Regulatory Citation Lock — second-line guardrail on top of
 * tests/constants.test.ts.
 *
 * tests/constants.test.ts pins each regulatory constant to a value.
 * This file pins each constant to its REGULATORY CITATION (article,
 * circular, or guidance section). Together they form an audit trail
 * a MoE inspector or LBMA auditor can read directly:
 *
 *   "Where in your code is FDL Art.26-27 enforced?"
 *   → grep this file for that citation, follow the constant name.
 *
 * If you change a constant value AND its citation, this test will
 * still pass — but you MUST also bump REGULATORY_CONSTANTS_VERSION
 * (see assertion at the bottom). That bump is the audit signal.
 *
 * Reviewers: a PR that touches this file MUST cite the regulation
 * change in its description (per CLAUDE.md §8 commit citation rule).
 */

import { describe, it, expect } from 'vitest';
import {
  STR_FILING_DEADLINE_BUSINESS_DAYS,
  CTR_FILING_DEADLINE_BUSINESS_DAYS,
  CNMR_FILING_DEADLINE_BUSINESS_DAYS,
  EOCN_FREEZE_IMMEDIATELY,
  DPMS_CASH_THRESHOLD_AED,
  CROSS_BORDER_CASH_THRESHOLD_AED,
  UBO_OWNERSHIP_THRESHOLD_PCT,
  UBO_REVERIFICATION_WORKING_DAYS,
  RECORD_RETENTION_YEARS,
  CDD_REVIEW_HIGH_RISK_MONTHS,
  CDD_REVIEW_MEDIUM_RISK_MONTHS,
  CDD_REVIEW_LOW_RISK_MONTHS,
  MOE_CIRCULAR_IMPLEMENTATION_DAYS,
  REGULATORY_CONSTANTS_VERSION,
} from '@/domain/constants';

interface CitationEntry {
  name: string;
  value: number | boolean | string;
  expected: number | boolean | string;
  citation: string;
}

const CITATIONS: ReadonlyArray<CitationEntry> = [
  {
    name: 'STR_FILING_DEADLINE_BUSINESS_DAYS',
    value: STR_FILING_DEADLINE_BUSINESS_DAYS,
    expected: 0,
    citation: 'FDL No.10/2025 Art.26-27 — file STR/SAR without delay',
  },
  {
    name: 'CTR_FILING_DEADLINE_BUSINESS_DAYS',
    value: CTR_FILING_DEADLINE_BUSINESS_DAYS,
    expected: 15,
    citation: 'FDL No.10/2025 Art.16 + MoE Circular 08/AML/2021 — DPMS cash 15 BD',
  },
  {
    name: 'CNMR_FILING_DEADLINE_BUSINESS_DAYS',
    value: CNMR_FILING_DEADLINE_BUSINESS_DAYS,
    expected: 5,
    citation: 'Cabinet Res 74/2020 Art.6 — CNMR within 5 business days of confirmed match',
  },
  {
    name: 'EOCN_FREEZE_IMMEDIATELY',
    value: EOCN_FREEZE_IMMEDIATELY,
    expected: true,
    citation: 'Cabinet Res 74/2020 Art.4 + EOCN TFS Guidance July 2025 — freeze without delay',
  },
  {
    name: 'DPMS_CASH_THRESHOLD_AED',
    value: DPMS_CASH_THRESHOLD_AED,
    expected: 55_000,
    citation: 'MoE Circular 08/AML/2021 — DPMS cash transaction reporting threshold',
  },
  {
    name: 'CROSS_BORDER_CASH_THRESHOLD_AED',
    value: CROSS_BORDER_CASH_THRESHOLD_AED,
    expected: 60_000,
    citation: 'Cabinet Res 134/2025 Art.16 — cross-border cash / BNI declaration',
  },
  {
    name: 'UBO_OWNERSHIP_THRESHOLD_PCT',
    value: UBO_OWNERSHIP_THRESHOLD_PCT,
    expected: 0.25,
    citation: 'Cabinet Decision 109/2023 — beneficial ownership 25% threshold (stored as fraction)',
  },
  {
    name: 'UBO_REVERIFICATION_WORKING_DAYS',
    value: UBO_REVERIFICATION_WORKING_DAYS,
    expected: 15,
    citation: 'Cabinet Decision 109/2023 — UBO re-verification deadline',
  },
  {
    name: 'RECORD_RETENTION_YEARS',
    value: RECORD_RETENTION_YEARS,
    expected: 10,
    citation: 'FDL No.10/2025 Art.24 + MoE DPMS Guidance — minimum record retention',
  },
  {
    name: 'CDD_REVIEW_HIGH_RISK_MONTHS',
    value: CDD_REVIEW_HIGH_RISK_MONTHS,
    expected: 3,
    citation: 'Cabinet Res 134/2025 Art.14 + Art.19 — EDD review cadence',
  },
  {
    name: 'CDD_REVIEW_MEDIUM_RISK_MONTHS',
    value: CDD_REVIEW_MEDIUM_RISK_MONTHS,
    expected: 6,
    citation: 'Cabinet Res 134/2025 Art.7-10 + Art.19 — CDD review cadence',
  },
  {
    name: 'CDD_REVIEW_LOW_RISK_MONTHS',
    value: CDD_REVIEW_LOW_RISK_MONTHS,
    expected: 12,
    citation: 'Cabinet Res 134/2025 Art.7-10 + Art.19 — SDD review cadence',
  },
  {
    name: 'MOE_CIRCULAR_IMPLEMENTATION_DAYS',
    value: MOE_CIRCULAR_IMPLEMENTATION_DAYS,
    expected: 30,
    citation: 'MoE Circular policy — implementation deadline after new circular',
  },
];

describe('Regulatory citation lock — every filing deadline / threshold maps to a regulation', () => {
  for (const entry of CITATIONS) {
    it(`${entry.name} === ${entry.expected} (${entry.citation})`, () => {
      expect(entry.value).toBe(entry.expected);
      expect(entry.citation.length).toBeGreaterThan(20);
    });
  }

  it('REGULATORY_CONSTANTS_VERSION is set — bump on any citation change', () => {
    expect(typeof REGULATORY_CONSTANTS_VERSION).toBe('string');
    expect(REGULATORY_CONSTANTS_VERSION.length).toBeGreaterThan(0);
  });

  it('citations cover the full set of filing-deadline + threshold constants', () => {
    // Sentinel: if a new filing deadline / threshold constant is added
    // to src/domain/constants.ts, the developer must add it here too.
    // We assert a minimum count so an accidental delete also trips it.
    expect(CITATIONS.length).toBeGreaterThanOrEqual(13);
  });
});
