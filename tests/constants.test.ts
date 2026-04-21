/**
 * Regulatory Constants Guardrails
 *
 * These tests exist to PREVENT accidental changes to legally mandated values.
 * If a test fails, it means someone changed a regulatory constant.
 * Only update these tests when the underlying regulation actually changes.
 */
import {
  DPMS_CASH_THRESHOLD_AED,
  CROSS_BORDER_CASH_THRESHOLD_AED,
  USD_TO_AED,
  VALUATION_ANOMALY_PCT,
  WEIGHT_DISCREPANCY_PCT,
  CERTIFICATION_THRESHOLD_AED,
  STRUCTURING_CUMULATIVE_PCT,
  DORMANCY_DAYS,
  UBO_OWNERSHIP_THRESHOLD_PCT,
  UBO_REVERIFICATION_WORKING_DAYS,
  STR_FILING_DEADLINE_BUSINESS_DAYS,
  CTR_FILING_DEADLINE_BUSINESS_DAYS,
  CNMR_FILING_DEADLINE_BUSINESS_DAYS,
  MOE_CIRCULAR_IMPLEMENTATION_DAYS,
  RECORD_RETENTION_YEARS,
  CDD_REVIEW_HIGH_RISK_MONTHS,
  CDD_REVIEW_MEDIUM_RISK_MONTHS,
  CDD_REVIEW_LOW_RISK_MONTHS,
  SESSION_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  MAX_FAILED_LOGIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  PENALTY_RANGE,
  RISK_THRESHOLDS,
  EOCN_FREEZE_IMMEDIATELY,
  DORMANCY_REACTIVATION_MIN_AED,
  PF_HIGH_RISK_JURISDICTIONS,
  FATF_GREY_LIST,
  EU_HIGH_RISK_COUNTRIES,
  DUAL_USE_KEYWORDS,
  REGULATORY_CONSTANTS_VERSION,
  SUPPLY_CHAIN_RISK_POINTS,
} from '@/domain/constants';

describe('Transaction Thresholds (FDL No.10/2025)', () => {
  it('DPMS cash threshold is AED 55,000 (Art.16)', () => {
    expect(DPMS_CASH_THRESHOLD_AED).toBe(55_000);
  });

  it('Cross-border cash threshold is AED 60,000 (Art.17)', () => {
    expect(CROSS_BORDER_CASH_THRESHOLD_AED).toBe(60_000);
  });

  it('USD/AED peg is 3.6725 (CBUAE)', () => {
    expect(USD_TO_AED).toBe(3.6725);
  });

  it('Valuation anomaly is 25% (UAE NRA 2024)', () => {
    expect(VALUATION_ANOMALY_PCT).toBe(0.25);
  });

  it('Weight discrepancy is 5%', () => {
    expect(WEIGHT_DISCREPANCY_PCT).toBe(0.05);
  });

  it('Certification threshold is AED 10,000', () => {
    expect(CERTIFICATION_THRESHOLD_AED).toBe(10_000);
  });

  it('Structuring cumulative percentage is 73%', () => {
    expect(STRUCTURING_CUMULATIVE_PCT).toBe(0.73);
  });

  it('Dormancy window is 90 days', () => {
    expect(DORMANCY_DAYS).toBe(90);
  });
});

describe('Beneficial Ownership (Cabinet Decision 109/2023)', () => {
  it('UBO threshold is 25%', () => {
    expect(UBO_OWNERSHIP_THRESHOLD_PCT).toBe(0.25);
  });

  it('Re-verification deadline is 15 working days', () => {
    expect(UBO_REVERIFICATION_WORKING_DAYS).toBe(15);
  });
});

describe('Filing Deadlines (FDL No.10/2025, EOCN TFS Guidance 2025)', () => {
  it('STR filing is without delay — 0 business days (FDL Art.26-27, FIU Guidance)', () => {
    expect(STR_FILING_DEADLINE_BUSINESS_DAYS).toBe(0);
  });

  it('CTR filing is 15 business days (FDL Art.16)', () => {
    expect(CTR_FILING_DEADLINE_BUSINESS_DAYS).toBe(15);
  });

  it('CNMR filing is 5 business days (Cabinet Res 74/2020 Art.6)', () => {
    expect(CNMR_FILING_DEADLINE_BUSINESS_DAYS).toBe(5);
  });

  it('MoE circular implementation is 30 calendar days', () => {
    expect(MOE_CIRCULAR_IMPLEMENTATION_DAYS).toBe(30);
  });

  it('EOCN asset freeze must be immediate (Cabinet Res 74/2020)', () => {
    expect(EOCN_FREEZE_IMMEDIATELY).toBe(true);
  });
});

describe('Record Retention (FDL No.10/2025, MoE DPMS Guidance)', () => {
  it('Minimum retention is 10 years', () => {
    expect(RECORD_RETENTION_YEARS).toBe(10);
  });
});

describe('CDD Review Frequencies (Cabinet Res 134/2025)', () => {
  it('High-risk review every 3 months', () => {
    expect(CDD_REVIEW_HIGH_RISK_MONTHS).toBe(3);
  });

  it('Medium-risk review every 6 months', () => {
    expect(CDD_REVIEW_MEDIUM_RISK_MONTHS).toBe(6);
  });

  it('Low-risk review every 12 months', () => {
    expect(CDD_REVIEW_LOW_RISK_MONTHS).toBe(12);
  });
});

describe('Session & Security Controls', () => {
  it('Session timeout is 2 hours (7,200,000 ms)', () => {
    expect(SESSION_TIMEOUT_MS).toBe(7_200_000);
  });

  it('Idle timeout is 30 minutes (1,800,000 ms)', () => {
    expect(IDLE_TIMEOUT_MS).toBe(1_800_000);
  });

  it('Account locks after 5 failed attempts', () => {
    expect(MAX_FAILED_LOGIN_ATTEMPTS).toBe(5);
  });

  it('Lockout duration is 15 minutes (900,000 ms)', () => {
    expect(LOCKOUT_DURATION_MS).toBe(900_000);
  });
});

describe('Penalty Range (Cabinet Res 71/2024)', () => {
  it('Minimum penalty is AED 10,000', () => {
    expect(PENALTY_RANGE.minAED).toBe(10_000);
  });

  it('Maximum penalty is AED 100,000,000', () => {
    expect(PENALTY_RANGE.maxAED).toBe(100_000_000);
  });
});

describe('Risk Scoring Thresholds', () => {
  it('Critical threshold is 16', () => {
    expect(RISK_THRESHOLDS.critical).toBe(16);
  });

  it('High threshold is 11', () => {
    expect(RISK_THRESHOLDS.high).toBe(11);
  });

  it('Medium threshold is 6', () => {
    expect(RISK_THRESHOLDS.medium).toBe(6);
  });
});

describe('Dormancy Reactivation', () => {
  it('Dormancy reactivation minimum is AED 20,000', () => {
    expect(DORMANCY_REACTIVATION_MIN_AED).toBe(20_000);
  });
});

describe('PF High-Risk Jurisdictions (Cabinet Res 156/2025)', () => {
  it('includes North Korea (KP)', () => {
    expect(PF_HIGH_RISK_JURISDICTIONS).toContain('KP');
  });

  it('includes Iran (IR)', () => {
    expect(PF_HIGH_RISK_JURISDICTIONS).toContain('IR');
  });
});

describe('FATF Grey List', () => {
  it('has 23 countries (Feb 2026 update)', () => {
    expect(FATF_GREY_LIST).toHaveLength(23);
  });

  it('includes Algeria (DZ)', () => {
    expect(FATF_GREY_LIST).toContain('DZ');
  });

  it('includes Nigeria (NG)', () => {
    expect(FATF_GREY_LIST).toContain('NG');
  });
});

describe('EU High-Risk Third Countries', () => {
  it('includes Afghanistan (AF)', () => {
    expect(EU_HIGH_RISK_COUNTRIES).toContain('AF');
  });

  it('includes Myanmar (MM)', () => {
    expect(EU_HIGH_RISK_COUNTRIES).toContain('MM');
  });
});

describe('Dual-Use Keywords (PF Monitoring)', () => {
  it('includes centrifuge', () => {
    expect(DUAL_USE_KEYWORDS).toContain('centrifuge');
  });

  it('includes uranium', () => {
    expect(DUAL_USE_KEYWORDS).toContain('uranium');
  });

  it('includes nuclear', () => {
    expect(DUAL_USE_KEYWORDS).toContain('nuclear');
  });
});

describe('Regulatory Constants Version', () => {
  it('is a date string matching YYYY-MM-DD format', () => {
    expect(REGULATORY_CONSTANTS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Cabinet Res 156/2025 PF deep-dive constants', () => {
  it('exposes annual full re-baseline cadence', async () => {
    const m = await import('../src/domain/constants');
    expect(m.PF_RISK_ASSESSMENT_REBASELINE_MONTHS).toBe(12);
  });

  it('exposes mid-cycle review cadence', async () => {
    const m = await import('../src/domain/constants');
    expect(m.PF_RISK_REVIEW_MONTHS).toBe(6);
  });

  it('escalation score is in [0, 1]', async () => {
    const m = await import('../src/domain/constants');
    expect(m.PF_RISK_ESCALATION_SCORE).toBeGreaterThan(0);
    expect(m.PF_RISK_ESCALATION_SCORE).toBeLessThanOrEqual(1);
  });

  it('CO review deadline is in business days', async () => {
    const m = await import('../src/domain/constants');
    expect(m.PF_REVIEW_DEADLINE_BUSINESS_DAYS).toBeGreaterThan(0);
    expect(m.PF_REVIEW_DEADLINE_BUSINESS_DAYS).toBeLessThanOrEqual(15);
  });

  it('strategic-goods declaration deadline is short and non-zero', async () => {
    const m = await import('../src/domain/constants');
    expect(m.STRATEGIC_GOODS_DECLARATION_BUSINESS_DAYS).toBeGreaterThan(0);
    expect(m.STRATEGIC_GOODS_DECLARATION_BUSINESS_DAYS).toBeLessThanOrEqual(5);
  });

  it('PF pause-and-report uses CLOCK hours, not business days', async () => {
    const m = await import('../src/domain/constants');
    expect(m.PF_PAUSE_REPORT_CLOCK_HOURS).toBe(24);
  });

  it('lists every UNSC + EOCN designation list in the PF screening loop', async () => {
    const m = await import('../src/domain/constants');
    expect(m.PF_DESIGNATION_LISTS).toContain('UNSC-1718');
    expect(m.PF_DESIGNATION_LISTS).toContain('UNSC-2231');
    expect(m.PF_DESIGNATION_LISTS).toContain('UNSC-1540');
    expect(m.PF_DESIGNATION_LISTS).toContain('EOCN-PF');
  });

  it('end-use red flags is a non-empty list of strings', async () => {
    const m = await import('../src/domain/constants');
    expect(Array.isArray(m.PF_END_USE_RED_FLAGS)).toBe(true);
    expect(m.PF_END_USE_RED_FLAGS.length).toBeGreaterThan(0);
    for (const f of m.PF_END_USE_RED_FLAGS) {
      expect(typeof f).toBe('string');
      expect(f.length).toBeGreaterThan(0);
    }
  });

  it('end-use flag weight is bounded so a maximally-flagged case meets escalation', async () => {
    const m = await import('../src/domain/constants');
    expect(m.PF_END_USE_FLAG_WEIGHT).toBeGreaterThan(0);
    expect(m.PF_END_USE_FLAG_WEIGHT).toBeLessThanOrEqual(1);
    // Sanity: a few flags at the per-flag weight should be enough to
    // reach the escalation floor.
    expect(m.PF_END_USE_FLAG_WEIGHT * 5).toBeGreaterThanOrEqual(
      m.PF_RISK_ESCALATION_SCORE,
    );
  });

  it('annual training hours is a positive integer', async () => {
    const m = await import('../src/domain/constants');
    expect(m.PF_ANNUAL_TRAINING_HOURS).toBeGreaterThan(0);
    expect(Number.isInteger(m.PF_ANNUAL_TRAINING_HOURS)).toBe(true);
  });

  it('PF risk assessment max age in days exceeds the rebaseline cadence', async () => {
    const m = await import('../src/domain/constants');
    expect(m.PF_RISK_ASSESSMENT_MAX_AGE_DAYS).toBeGreaterThan(
      m.PF_RISK_ASSESSMENT_REBASELINE_MONTHS * 30,
    );
  });
});

describe('Supply Chain Risk Points', () => {
  it('maxScore is 100', () => {
    expect(SUPPLY_CHAIN_RISK_POINTS.maxScore).toBe(100);
  });

  it('highThreshold is greater than mediumThreshold (sanity check)', () => {
    expect(SUPPLY_CHAIN_RISK_POINTS.highThreshold).toBeGreaterThan(
      SUPPLY_CHAIN_RISK_POINTS.mediumThreshold,
    );
  });
});

// PR-2 — LSEG World-Check One parity for entity types. Vessel intentionally
// absent here; when the goAML mapping decision is made, add it to the
// canonical list and extend these tests.
describe('Screening entity types (PR-2)', () => {
  it('canonical list is exactly [individual, organisation, unspecified]', async () => {
    const { ENTITY_TYPES_SUPPORTED } = await import('../src/domain/constants');
    expect([...ENTITY_TYPES_SUPPORTED]).toEqual(['individual', 'organisation', 'unspecified']);
  });

  it('normaliseEntityType passes canonical values through', async () => {
    const { normaliseEntityType } = await import('../src/domain/constants');
    expect(normaliseEntityType('individual')).toBe('individual');
    expect(normaliseEntityType('organisation')).toBe('organisation');
    expect(normaliseEntityType('unspecified')).toBe('unspecified');
  });

  it('normaliseEntityType maps legacy server-side "legal_entity" to "organisation"', async () => {
    const { normaliseEntityType } = await import('../src/domain/constants');
    expect(normaliseEntityType('legal_entity')).toBe('organisation');
  });

  it('normaliseEntityType maps legacy TFS dropdown values', async () => {
    const { normaliseEntityType } = await import('../src/domain/constants');
    expect(normaliseEntityType('Individual')).toBe('individual');
    expect(normaliseEntityType('Company')).toBe('organisation');
  });

  it('normaliseEntityType accepts US spelling and canonicalises', async () => {
    const { normaliseEntityType } = await import('../src/domain/constants');
    expect(normaliseEntityType('organization')).toBe('organisation');
    expect(normaliseEntityType('ORGANIZATION')).toBe('organisation');
  });

  it('normaliseEntityType returns null for unknown values (no silent coercion)', async () => {
    const { normaliseEntityType } = await import('../src/domain/constants');
    expect(normaliseEntityType('robot')).toBeNull();
    expect(normaliseEntityType('')).toBeNull();
    expect(normaliseEntityType(undefined)).toBeNull();
    expect(normaliseEntityType(null)).toBeNull();
    expect(normaliseEntityType(42)).toBeNull();
  });
});
