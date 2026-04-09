/**
 * Centralized Regulatory Constants — Single Source of Truth
 *
 * ALL thresholds, deadlines, and country lists referenced across the codebase
 * MUST come from this file. If a regulation changes, update HERE and all
 * modules reflect it automatically.
 *
 * DO NOT hardcode thresholds in other files. Import from here.
 */

// ─── Transaction Thresholds ─────────────────────────────────────────────────

/** AED 55,000 — DPMS cash transaction reporting threshold (FDL Art.16, MoE Circular 08/AML/2021) */
export const DPMS_CASH_THRESHOLD_AED = 55_000;

/** AED 60,000 — Cross-border cash/BNI declaration threshold (FDL Art.17, Cabinet Res 134/2025 Art.16) */
export const CROSS_BORDER_CASH_THRESHOLD_AED = 60_000;

/** USD/AED peg rate — CBUAE official peg. Update ONLY if CBUAE changes peg. */
export const USD_TO_AED = 3.6725;

/** Valuation anomaly deviation threshold — >25% triggers alert (UAE NRA 2024, FATF Rec 20) */
export const VALUATION_ANOMALY_PCT = 0.25;

/** Weight/purity discrepancy threshold — >5% triggers alert */
export const WEIGHT_DISCREPANCY_PCT = 0.05;

/** Minimum transaction amount for certification requirements (hallmark/assay/origin) */
export const CERTIFICATION_THRESHOLD_AED = 10_000;

/** Structuring detection — cumulative % of threshold that triggers alert (73%) */
export const STRUCTURING_CUMULATIVE_PCT = 0.73;

/** Dormancy reactivation window — days of inactivity before reactivation alert */
export const DORMANCY_DAYS = 90;

/** Dormancy reactivation minimum transaction amount */
export const DORMANCY_REACTIVATION_MIN_AED = 20_000;

/** Profile mismatch threshold — low-risk customer (Cabinet Res 134/2025) */
export const LOW_RISK_PROFILE_THRESHOLD_AED = 200_000;

/** Profile mismatch threshold — medium-risk customer (Cabinet Res 134/2025) */
export const MEDIUM_RISK_PROFILE_THRESHOLD_AED = 500_000;

/** Round-tripping detection threshold — circular payments above this amount (FATF Typologies) */
export const ROUND_TRIPPING_THRESHOLD_AED = 100_000;

/** Rapid buy-sell detection threshold (UAE NRA 2024 DPMS risk indicators) */
export const RAPID_BUYSELL_THRESHOLD_AED = 20_000;

// ─── Beneficial Ownership ───────────────────────────────────────────────────

/** UBO threshold — ownership % that triggers beneficial ownership registration (Cabinet Decision 109/2023) */
export const UBO_OWNERSHIP_THRESHOLD_PCT = 0.25;

/** UBO re-verification deadline — working days after ownership change (Cabinet Decision 109/2023) */
export const UBO_REVERIFICATION_WORKING_DAYS = 15;

// ─── Filing Deadlines ───────────────────────────────────────────────────────

/**
 * STR/SAR — file WITHOUT DELAY upon suspicion confirmation (FDL No.10/2025 Art.26-27).
 * The UAE FIU interprets "without delay" as absolute immediacy — the moment
 * suspicion is solidified. This constant represents the outer regulatory
 * backstop (business days), NOT a grace period to wait before filing.
 */
export const STR_FILING_DEADLINE_BUSINESS_DAYS = 0;

/** CTR (DPMSR) — file within 15 business days (FDL Art.16) */
export const CTR_FILING_DEADLINE_BUSINESS_DAYS = 15;

/**
 * EOCN asset freeze — execute IMMEDIATELY without delay (Cabinet Res 74/2020 Art.4,
 * EOCN TFS Guidance July 2025). "Without delay" means freezing within hours of
 * designation — EOCN guidance states 1-2 hours maximum. Must maintain freeze
 * capability even during weekends and public holidays.
 */
export const EOCN_FREEZE_IMMEDIATELY = true;

/** CNMR filing — within 5 business days of confirmed match (Cabinet Res 74/2020 Art.6) */
export const CNMR_FILING_DEADLINE_BUSINESS_DAYS = 5;

/** Policy update deadline after new MoE circular — 30 calendar days */
export const MOE_CIRCULAR_IMPLEMENTATION_DAYS = 30;

// ─── Record Retention ───────────────────────────────────────────────────────

/** Minimum record retention — 10 years (FDL No.10/2025, MoE DPMS Guidance) */
export const RECORD_RETENTION_YEARS = 10;

// ─── CDD Review Frequencies ────────────────────────────────────────────────

/** High-risk customer CDD review frequency — months */
export const CDD_REVIEW_HIGH_RISK_MONTHS = 3;

/** Medium-risk customer CDD review frequency — months */
export const CDD_REVIEW_MEDIUM_RISK_MONTHS = 6;

/** Low-risk customer CDD review frequency — months */
export const CDD_REVIEW_LOW_RISK_MONTHS = 12;

// ─── Session & Security ─────────────────────────────────────────────────────

/** Session timeout — 2 hours */
export const SESSION_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** Idle timeout — 30 minutes */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Max failed login attempts before lockout */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/** Account lockout duration — 15 minutes */
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// ─── Penalty Ranges ─────────────────────────────────────────────────────────

/** Administrative penalty range — Cabinet Res 71/2024 */
export const PENALTY_RANGE = {
  minAED: 10_000,
  maxAED: 100_000_000,
} as const;

// ─── Risk Scoring ───────────────────────────────────────────────────────────

/** Risk level thresholds (from src/risk/scoring.ts) */
export const RISK_THRESHOLDS = {
  critical: 16,
  high: 11,
  medium: 6,
} as const;

/** Supply chain risk scoring */
export const SUPPLY_CHAIN_RISK_POINTS = {
  cahraCritical: 40,
  cahraHigh: 25,
  cahraMedium: 15,
  fatfGrey: 15,
  euHighRisk: 15,
  missingMineOrigin: 15,
  noRefiner: 10,
  noAudit: 15,
  auditInProgress: 5,
  auditNA: 10,
  asmSource: 15,
  kycIncomplete: 10,
  maxScore: 100,
  highThreshold: 50,
  mediumThreshold: 25,
} as const;

// ─── Sanctions Lists ────────────────────────────────────────────────────────

/** PF high-risk jurisdictions (Cabinet Res 156/2025, UNSC Res 1718/2231) */
export const PF_HIGH_RISK_JURISDICTIONS = ['KP', 'IR', 'SY', 'MM', 'YE'] as const;

/** FATF Grey List — as of Feb 2026. UPDATE when FATF publishes new list. */
export const FATF_GREY_LIST = [
  'DZ',
  'AO',
  'BG',
  'BF',
  'CM',
  'HR',
  'CD',
  'EG',
  'HT',
  'KE',
  'LB',
  'MG',
  'MC',
  'MZ',
  'NA',
  'NG',
  'PH',
  'SN',
  'ZA',
  'SS',
  'SY',
  'VE',
  'YE',
] as const;

/** EU High-Risk Third Countries — Delegated Regulation 2026 update */
export const EU_HIGH_RISK_COUNTRIES = [
  'AF',
  'BB',
  'BF',
  'MM',
  'KH',
  'KY',
  'CD',
  'GI',
  'HT',
  'JM',
  'JO',
  'ML',
  'MZ',
  'NG',
  'PA',
  'PH',
  'SN',
  'ZA',
  'SS',
  'SY',
  'TT',
] as const;

// ─── Dual-Use Indicators (PF Monitoring) ────────────────────────────────────

export const DUAL_USE_KEYWORDS = [
  'centrifuge',
  'uranium',
  'plutonium',
  'tritium',
  'deuterium',
  'maraging steel',
  'carbon fiber',
  'beryllium',
  'zirconium',
  'tungsten carbide',
  'missile',
  'guidance system',
  'gyroscope',
  'accelerometer',
  'propellant',
  'rocket motor',
  'launch vehicle',
  'reentry vehicle',
  'telemetry',
  'high-speed camera',
  'flash x-ray',
  'detonator',
  'explosive lens',
  'shaped charge',
  'nuclear',
  'enrichment',
  'reactor',
  'heavy water',
  'frequency converter',
  'mass spectrometer',
  'vacuum pump',
  'filament winding',
  'flow-forming',
  'isostatic press',
  'electron beam welder',
  'plasma torch',
  'rare earth',
  'palladium catalyst',
  'rhodium',
  'iridium',
  'osmium',
  'nickel powder',
  'aluminium alloy',
  'titanium alloy',
  'cobalt',
  'vanadium',
] as const;

// ─── Version ────────────────────────────────────────────────────────────────

/** Last regulatory update date — update when any constant changes */
export const REGULATORY_CONSTANTS_VERSION = '2026-04-08';
export const REGULATORY_CONSTANTS_NOTES =
  'Updated: record retention 5yr→10yr (MoE DPMS Guidance), STR filing to "without delay" (FIU), asset freeze to immediate (EOCN TFS Guidance July 2025). FDL No.10/2025, Cabinet Res 134/2025, 74/2020, 156/2025, 71/2024, 109/2023.';
