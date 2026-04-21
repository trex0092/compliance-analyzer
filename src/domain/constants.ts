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

// ─── Cabinet Res 156/2025 — PF & Dual-Use Controls (deep-dive) ──────────────
//
// Cabinet Resolution 156/2025 supplements FDL No.10/2025 Art.35 with explicit
// proliferation-financing (PF) controls covering: PF risk assessment cycle,
// strategic-goods screening obligations, end-user/end-use scrutiny, and
// pause-and-report duties for ambiguous shipments to high-risk jurisdictions.
//
// These constants encode the deadlines, score floors, and review cadences
// that the resolution makes operational. They are imported by:
//   - src/services/pfRiskAssessment.ts (annual + event-driven cycles)
//   - src/services/strategicGoodsScreening.ts (keyword + HS-code matching)
//   - src/services/multiModelScreening.ts (PF list inclusion)
//
// Regulatory basis:
//   Cabinet Res 156/2025 (UAE PF & Dual-Use Controls)
//   FDL No.10/2025 Art.35 (TFS — sanctions umbrella)
//   UNSC Res 1540 (international PF framework)
//   UNSC Res 1718 / 2231 (DPRK + Iran sanctions)
//   FATF Rec 7 (PF-specific TFS)

/** PF risk assessment full re-baseline cadence — months. */
export const PF_RISK_ASSESSMENT_REBASELINE_MONTHS = 12;

/**
 * PF risk assessment review cadence — months. The lighter mid-cycle
 * review that happens between full re-baselines (Cabinet Res 156/2025
 * Art.7).
 */
export const PF_RISK_REVIEW_MONTHS = 6;

/**
 * Score floor on the PF risk register that triggers a mandatory
 * Compliance Officer escalation. Below this score the case stays in
 * routine monitoring; at or above it the CO must review and document
 * a decision within PF_REVIEW_DEADLINE_BUSINESS_DAYS.
 */
export const PF_RISK_ESCALATION_SCORE = 0.65;

/**
 * Deadline (business days) for CO review of a flagged PF case. Aligns
 * with the general internal review cadence under Cabinet Res 134/2025
 * Art.19 but is set explicitly here so PF-specific reporting paths
 * cannot drift from the broader compliance schedule.
 */
export const PF_REVIEW_DEADLINE_BUSINESS_DAYS = 5;

/**
 * Strategic-goods declaration deadline — business days from the date
 * a dual-use keyword match is confirmed to the date the declaration
 * must be filed with the Ministry of Economy + the Federal Authority
 * for Nuclear Regulation (FANR) where applicable.
 */
export const STRATEGIC_GOODS_DECLARATION_BUSINESS_DAYS = 3;

/**
 * Pause-and-report duration for ambiguous PF shipments. When a case
 * matches one or more dual-use keywords AND a high-risk jurisdiction
 * but does not yet rise to confirmed PF, the operator MUST pause the
 * transaction for this many clock hours while screening completes.
 * Cabinet Res 156/2025 Art.9.
 */
export const PF_PAUSE_REPORT_CLOCK_HOURS = 24;

/**
 * UNSC PF designation lists that the screening pipeline MUST cover.
 * Used by multiModelScreening.ts to assert no list is silently
 * dropped from the screening loop.
 */
export const PF_DESIGNATION_LISTS = [
  'UNSC-1718', // DPRK
  'UNSC-2231', // Iran JCPOA / E3+3
  'UNSC-1540', // International PF framework
  'EOCN-PF', // UAE Executive Office for Control & Non-Proliferation PF list
] as const;

/**
 * End-use red flags — keywords whose appearance in a customer's stated
 * end-use narrative escalates the PF risk score by EU_END_USE_FLAG_WEIGHT.
 * Cabinet Res 156/2025 Art.10 (end-user / end-use scrutiny).
 */
export const PF_END_USE_RED_FLAGS = [
  'unspecified end-use',
  'reseller — final destination unknown',
  'transit only',
  'free zone re-export',
  'broker on behalf of undisclosed buyer',
  'cash purchase, no delivery address',
  'evasive about destination',
  'requested non-standard documentation',
] as const;

/**
 * Per-flag weight added to the PF risk score for each end-use red
 * flag triggered. Capped at 1.0 in the scorer so a maximally-flagged
 * case lands cleanly on PF_RISK_ESCALATION_SCORE without over-firing.
 */
export const PF_END_USE_FLAG_WEIGHT = 0.15;

/**
 * Annual PF training requirement for all customer-facing staff —
 * minimum hours per calendar year. Cabinet Res 156/2025 Art.13.
 */
export const PF_ANNUAL_TRAINING_HOURS = 4;

/**
 * Maximum age (calendar days) of an "active" PF risk assessment
 * before it is considered stale and a re-baseline is forced. Aligns
 * with the rebase cadence above but is enforced as a calendar
 * deadline so a missed business-day window cannot mask an overdue
 * assessment.
 */
export const PF_RISK_ASSESSMENT_MAX_AGE_DAYS = 400;

// ─── Screening entity types ─────────────────────────────────────────────────

/**
 * Canonical entity types for the screening command. Expanded from the
 * historical two-value set (`individual` / `legal_entity`) to match
 * LSEG World-Check One's subject taxonomy. Vessel intentionally
 * deferred — the goAML natural-person / legal-entity schema has no
 * vessel node and rushing a mapping would mask the decision.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (screening situational awareness)
 *   FDL No.10/2025 Art.24    (10-yr retention of screening records)
 *   FATF Rec 10              (ongoing CDD — subject classification)
 */
export const ENTITY_TYPES_SUPPORTED = ['individual', 'organisation', 'unspecified'] as const;
export type EntityTypeSupported = (typeof ENTITY_TYPES_SUPPORTED)[number];

/**
 * Legacy aliases — values written by older screens or earlier API
 * contracts that must still round-trip after the upgrade. Kept as a
 * separate map (rather than inlined in the supported list) so the
 * canonical UI always writes the new value and the alias table is
 * read-only compatibility surface.
 */
export const ENTITY_TYPE_LEGACY_ALIASES: Readonly<Record<string, EntityTypeSupported>> = {
  // Old server-side contract (netlify/functions/screening-save.mts pre-PR)
  legal_entity: 'organisation',
  // Old TFS modal dropdown values (compliance-suite.js pre-PR)
  Individual: 'individual',
  Company: 'organisation',
  // Belt-and-braces: case-insensitive canonical forms
  INDIVIDUAL: 'individual',
  ORGANISATION: 'organisation',
  ORGANIZATION: 'organisation',
  organization: 'organisation',
  UNSPECIFIED: 'unspecified',
};

/**
 * Normalise any incoming entityType value to the canonical form.
 * Returns `null` when the value is not recognised — callers MUST
 * reject on null rather than coerce silently (FDL Art.20-21: the
 * MLRO must see unknown inputs, not a coerced guess).
 */
export function normaliseEntityType(raw: unknown): EntityTypeSupported | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if ((ENTITY_TYPES_SUPPORTED as readonly string[]).includes(trimmed)) {
    return trimmed as EntityTypeSupported;
  }
  if (Object.prototype.hasOwnProperty.call(ENTITY_TYPE_LEGACY_ALIASES, trimmed)) {
    return ENTITY_TYPE_LEGACY_ALIASES[trimmed]!;
  }
  return null;
}

// ─── Version ────────────────────────────────────────────────────────────────

/** Last regulatory update date — update when any constant changes */
export const REGULATORY_CONSTANTS_VERSION = '2026-04-21';
export const REGULATORY_CONSTANTS_NOTES =
  'Updated: record retention 5yr→10yr (MoE DPMS Guidance), STR filing to "without delay" (FIU), asset freeze to immediate (EOCN TFS Guidance July 2025), Cabinet Res 156/2025 PF deep-dive constants (review cadence, escalation score, strategic-goods declaration deadline, pause-and-report duration, designation lists, end-use red flags, annual training hours). 2026-04-21: added ENTITY_TYPES_SUPPORTED (individual / organisation / unspecified) + legacy alias map for the screening command upgrade — LSEG WC-One parity, vessel deferred pending goAML mapping. FDL No.10/2025, Cabinet Res 134/2025, 74/2020, 156/2025, 71/2024, 109/2023.';
