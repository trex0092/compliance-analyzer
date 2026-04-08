/**
 * Constants Bridge — Makes TypeScript constants accessible to vanilla JS modules.
 *
 * This file mirrors src/domain/constants.ts so that the root .js files
 * (compliance-suite.js, workflow-engine.js, threshold-monitor.js, etc.)
 * can reference centralized values without ES module imports.
 *
 * HOW TO USE:
 *   Include this script before other .js files in index.html:
 *   <script src="constants-bridge.js"></script>
 *
 *   Then access: window.COMPLIANCE_CONSTANTS.DPMS_CASH_THRESHOLD_AED
 *
 * IMPORTANT: When updating src/domain/constants.ts, update this file too.
 * The test suite (tests/constants.test.ts) verifies the TypeScript values.
 */
(function (global) {
  'use strict';

  global.COMPLIANCE_CONSTANTS = Object.freeze({
    // Transaction Thresholds
    DPMS_CASH_THRESHOLD_AED: 55000,
    CROSS_BORDER_CASH_THRESHOLD_AED: 60000,
    USD_TO_AED: 3.6725,
    VALUATION_ANOMALY_PCT: 0.25,
    WEIGHT_DISCREPANCY_PCT: 0.05,
    CERTIFICATION_THRESHOLD_AED: 10000,
    STRUCTURING_CUMULATIVE_PCT: 0.73,
    DORMANCY_DAYS: 90,
    DORMANCY_REACTIVATION_MIN_AED: 20000,

    // Beneficial Ownership
    UBO_OWNERSHIP_THRESHOLD_PCT: 0.25,
    UBO_REVERIFICATION_WORKING_DAYS: 15,

    // Filing Deadlines
    STR_FILING_DEADLINE_BUSINESS_DAYS: 0, // Without delay (FDL Art.26-27, FIU Guidance)
    CTR_FILING_DEADLINE_BUSINESS_DAYS: 15,
    EOCN_FREEZE_IMMEDIATELY: true, // Immediate freeze (EOCN TFS Guidance July 2025)
    CNMR_FILING_DEADLINE_BUSINESS_DAYS: 5,
    MOE_CIRCULAR_IMPLEMENTATION_DAYS: 30,

    // Record Retention
    RECORD_RETENTION_YEARS: 10, // 10 years (FDL No.10/2025, MoE DPMS Guidance)

    // CDD Review Frequencies (months)
    CDD_REVIEW_HIGH_RISK_MONTHS: 3,
    CDD_REVIEW_MEDIUM_RISK_MONTHS: 6,
    CDD_REVIEW_LOW_RISK_MONTHS: 12,

    // Security
    SESSION_TIMEOUT_MS: 2 * 60 * 60 * 1000,
    IDLE_TIMEOUT_MS: 30 * 60 * 1000,
    MAX_FAILED_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION_MS: 15 * 60 * 1000,

    // Penalty Range (AED)
    PENALTY_MIN_AED: 10000,
    PENALTY_MAX_AED: 100000000,

    // Risk Scoring Thresholds
    RISK_CRITICAL: 16,
    RISK_HIGH: 11,
    RISK_MEDIUM: 6,

    // PF High-Risk Jurisdictions (deep frozen — immutable)
    get PF_HIGH_RISK_JURISDICTIONS() { return ['KP', 'IR', 'SY', 'MM', 'YE']; },

    // Version
    VERSION: '2026-04-08',
  });
})(typeof window !== 'undefined' ? window : globalThis);
