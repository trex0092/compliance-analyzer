/**
 * Customer Profile v2 — full KYC / CDD data model.
 *
 * Why this exists:
 *   The existing `CustomerProfile` in src/domain/customers.ts is a
 *   minimal skeleton — legal name, id, risk rating, PEP/sanctions
 *   status flags. That skeleton is enough for the brain to run
 *   screening on, but it is not enough to pass a UAE DPMS MoE
 *   inspection, which requires:
 *
 *     - Licence number + issuer + issue/expiry date
 *     - Business model explanation (plain language)
 *     - Expected monthly volume + transaction count
 *     - Full shareholder / UBO chain with >25% threshold
 *     - Managers / directors / authorised signatories
 *     - Emirates ID + passport numbers + expiry dates for every
 *       natural person, with 10yr retention (FDL Art.24)
 *     - Source of funds / wealth evidence references
 *     - Per-tier review cadence (SDD 12mo, CDD 6mo, EDD 3mo)
 *
 *   This module is the canonical data model. PURE — types + constants
 *   + helper pure functions. No I/O, no state, no network. Safe for
 *   tests, netlify functions, and the React UI layer.
 *
 *   The existing `COMPANY_REGISTRY` (src/domain/customers.ts) stays as
 *   a read-only seed of the 6 entities known to the tool today.
 *   Customer Profile v2 is a SEPARATE, richer store that the
 *   orchestrator upgrades to as new CDD data comes in.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12-14   (CDD — every field below is mandatory)
 *   FDL No.10/2025 Art.24      (10yr retention per entity)
 *   Cabinet Res 134/2025 Art.7-10 (CDD data collection per tier)
 *   Cabinet Res 134/2025 Art.14   (EDD + PEP Board approval)
 *   Cabinet Decision 109/2023     (UBO register >25% threshold)
 *   MoE Circular 08/AML/2021      (DPMS sector — licence expiry check)
 *   FATF Rec 10 (CDD), Rec 11 (record-keeping), Rec 12 (PEP)
 *
 * Date format: dd/mm/yyyy per CLAUDE.md §6 (UAE compliance standard).
 *   ISO 8601 is used only for timestamps (audit log fields).
 */

// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------

/**
 * dd/mm/yyyy date string per CLAUDE.md §6. This is a branded string
 * type — the validator in customerProfileValidator.ts enforces the
 * format at the system boundary so downstream code can trust it.
 */
export type DateDdMmYyyy = string;

/** ISO 8601 timestamp for audit fields (createdAt, lastReviewedAt). */
export type IsoTimestamp = string;

/** ISO-3166 alpha-2 country code (e.g. "AE", "GB", "US"). */
export type CountryCodeIso2 = string;

/**
 * UAE Emirates ID number format: 784-YYYY-NNNNNNN-N.
 * The first 3 digits are the UAE ISD code (784), next 4 = birth year,
 * next 7 = serial, last 1 = check digit.
 */
export type EmiratesIdNumber = string;

// ---------------------------------------------------------------------------
// Enums / string unions
// ---------------------------------------------------------------------------

export type CustomerType = 'natural' | 'legal';

export type LicenseStatus = 'active' | 'expired' | 'suspended' | 'cancelled';

export type CustomerSector =
  | 'precious-metals'
  | 'precious-metals-refining'
  | 'precious-metals-trading'
  | 'jewellery-retail'
  | 'jewellery-manufacturing'
  | 'bullion-trading'
  | 'other';

export type RiskTier = 'low' | 'medium' | 'high';

export type ScreeningStatus = 'pending' | 'clear' | 'potential' | 'confirmed_frozen';

export type PepStatus = 'clear' | 'potential' | 'confirmed';

export type EvidenceStatus = 'pending' | 'declared' | 'verified' | 'not_applicable';

export type EntityStructure = 'standalone' | 'headquarters' | 'branch' | 'subsidiary';

export type ManagerRole =
  | 'director'
  | 'general-manager'
  | 'authorised-signatory'
  | 'mlro'
  | 'co'
  | 'board-member'
  | 'other';

// ---------------------------------------------------------------------------
// Attachment reference
// ---------------------------------------------------------------------------

/**
 * A pointer to a document stored in the Netlify Blob store. Used for
 * licence PDFs, Emirates ID scans, passport copies, SoF evidence,
 * SoW evidence, UBO certificates, etc.
 *
 * Never store the document body here — only the blob key + sha256
 * for tamper detection.
 */
export interface AttachmentRef {
  readonly blobKey: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly uploadedAt: IsoTimestamp;
  readonly uploadedBy: string;
  /** SHA-256 hex of the content at upload time. Used for tamper detection. */
  readonly sha256: string;
}

// ---------------------------------------------------------------------------
// Shareholder / UBO record
// ---------------------------------------------------------------------------

/**
 * A shareholder is any person or entity that holds equity in the
 * customer. If they hold ≥ `UBO_OWNERSHIP_THRESHOLD_PERCENT` (25% per
 * Cabinet Decision 109/2023), they are classified as a UBO and require
 * enhanced verification + 15-working-day re-verification on any
 * ownership change.
 */
export interface ShareholderRecord {
  readonly id: string;
  readonly type: CustomerType;
  readonly fullName: string;
  /** Ownership percentage, 0..100. Summed across all shareholders must not exceed 100. */
  readonly ownershipPercent: number;

  // ----- Natural-person fields (required when type === 'natural') -----
  readonly dateOfBirth?: DateDdMmYyyy;
  readonly nationality?: CountryCodeIso2;
  readonly emiratesIdNumber?: EmiratesIdNumber;
  readonly emiratesIdExpiry?: DateDdMmYyyy;
  readonly passportNumber?: string;
  readonly passportCountry?: CountryCodeIso2;
  readonly passportExpiry?: DateDdMmYyyy;
  readonly residentialAddress?: string;

  // ----- Legal-entity fields (required when type === 'legal') -----
  readonly registrationCountry?: CountryCodeIso2;
  readonly registrationNumber?: string;
  /**
   * Upward chain of parent entities terminating in an ultimate
   * natural-person UBO. Stored as customer ids so the UI can
   * traverse. Only populated for `type === 'legal'`.
   */
  readonly parentChain?: readonly string[];

  // ----- Screening (applies to both natural + legal) -----
  readonly pepCheckStatus: PepStatus;
  readonly sanctionsCheckStatus: ScreeningStatus;
  readonly adverseMediaCheckStatus: 'pending' | 'clear' | 'hits' | 'cleared';
  readonly lastScreenedAt?: IsoTimestamp;

  // ----- UBO-specific (Cabinet Decision 109/2023) -----
  readonly uboVerifiedAt?: DateDdMmYyyy;
  /**
   * Deadline for UBO re-verification after the most recent ownership
   * change. Set to 15 working days from the change event per Cabinet
   * Decision 109/2023. Computed by the business-days util.
   */
  readonly uboReverificationDueAt?: DateDdMmYyyy;

  // ----- Evidence -----
  readonly evidenceAttachments?: readonly AttachmentRef[];
}

// ---------------------------------------------------------------------------
// Manager / director / authorised signatory record
// ---------------------------------------------------------------------------

/**
 * A manager / director / authorised signatory. Distinct from a
 * shareholder: a manager may own 0% equity but still have operational
 * control. The MLRO + CO roles are special cases — their presence is
 * required by Cabinet Res 134/2025 Art.19 (four-eyes review) and
 * FDL Art.20-22 (CO oversight).
 */
export interface ManagerRecord {
  readonly id: string;
  readonly fullName: string;
  readonly role: ManagerRole;
  /** Free-text title when `role === 'other'`. */
  readonly roleTitle?: string;

  // ----- Identity (natural-person only — managers are always natural people) -----
  readonly dateOfBirth: DateDdMmYyyy;
  readonly nationality: CountryCodeIso2;
  readonly emiratesIdNumber?: EmiratesIdNumber;
  readonly emiratesIdExpiry?: DateDdMmYyyy;
  readonly passportNumber: string;
  readonly passportCountry: CountryCodeIso2;
  readonly passportExpiry: DateDdMmYyyy;

  // ----- Authority -----
  readonly appointmentDate: DateDdMmYyyy;
  /** Signing authority cap in AED. Undefined = no cap. */
  readonly authorityLimitAed?: number;
  /** Can this manager confirm a sanctions freeze decision? */
  readonly isSanctionsAuthority: boolean;
  /** Can this manager file an STR? */
  readonly isStrFilingAuthority: boolean;

  // ----- Screening -----
  readonly pepCheckStatus: PepStatus;
  readonly sanctionsCheckStatus: ScreeningStatus;
  readonly adverseMediaCheckStatus: 'pending' | 'clear' | 'hits' | 'cleared';
  readonly lastScreenedAt?: IsoTimestamp;

  // ----- Evidence -----
  readonly evidenceAttachments?: readonly AttachmentRef[];
}

// ---------------------------------------------------------------------------
// Customer Profile v2 — the canonical shape
// ---------------------------------------------------------------------------

/**
 * Full CDD record for a single customer. Every field below maps to
 * a specific UAE AML/CFT or FATF requirement. Producers of this type
 * (the UI form, the orchestrator, the auto-ingest endpoint) must all
 * go through the validator in customerProfileValidator.ts so missing
 * or expired fields are surfaced to the MLRO before persistence.
 */
export interface CustomerProfileV2 {
  readonly schemaVersion: 2;

  // ----- Identity -----
  readonly id: string;
  readonly legalName: string;
  readonly tradingName?: string;
  readonly customerType: CustomerType;

  // ----- Registration -----
  readonly country: CountryCodeIso2;
  readonly jurisdiction: string;
  readonly licenseNumber: string;
  readonly licenseIssuer: string;
  readonly licenseIssueDate: DateDdMmYyyy;
  readonly licenseExpiryDate: DateDdMmYyyy;
  readonly licenseStatus: LicenseStatus;

  // ----- Business -----
  readonly businessModel: string;
  readonly activity: string;
  readonly sector: CustomerSector;
  readonly expectedMonthlyVolumeAed: number;
  readonly expectedTransactionCountPerMonth: number;

  // ----- Risk posture -----
  readonly riskRating: RiskTier;
  readonly riskRatingAssignedAt: DateDdMmYyyy;
  readonly riskRatingExpiresAt: DateDdMmYyyy;
  readonly pepStatus: PepStatus;
  readonly sanctionsStatus: ScreeningStatus;

  // ----- Source of funds / wealth -----
  readonly sourceOfFundsStatus: EvidenceStatus;
  readonly sourceOfFundsEvidence?: readonly AttachmentRef[];
  readonly sourceOfWealthStatus: EvidenceStatus;
  readonly sourceOfWealthEvidence?: readonly AttachmentRef[];

  // ----- People -----
  readonly shareholders: readonly ShareholderRecord[];
  readonly managers: readonly ManagerRecord[];

  // ----- Relationships -----
  readonly groupId?: string;
  readonly groupName?: string;
  readonly entityType: EntityStructure;

  // ----- Audit -----
  readonly createdAt: IsoTimestamp;
  readonly lastReviewedAt?: IsoTimestamp;
  readonly lastReviewerUserId?: string;
  readonly nextReviewDueAt: DateDdMmYyyy;
  /**
   * Retention deadline computed as `createdAt + 10 years` per
   * FDL Art.24. Stored for fast query — the scheduled retention
   * cleanup job walks this field to find expirable records.
   */
  readonly recordRetentionUntil: DateDdMmYyyy;
}

// ---------------------------------------------------------------------------
// Regulatory constants — single source of truth
// ---------------------------------------------------------------------------

/**
 * Cabinet Decision 109/2023: a shareholder becomes a UBO at 25%
 * beneficial ownership. Changes here must also update
 * src/domain/constants.ts (the canonical AML constants file) and
 * bump REGULATORY_CONSTANTS_VERSION.
 */
export const UBO_OWNERSHIP_THRESHOLD_PERCENT = 25;

/** Cabinet Decision 109/2023: UBO re-verification deadline (working days). */
export const UBO_REVERIFICATION_WORKING_DAYS = 15;

/**
 * Periodic review cadence per risk tier (in months). Missing a
 * scheduled review is itself a Cabinet Res 134/2025 Art.19 finding.
 */
export const PERIODIC_REVIEW_MONTHS: Readonly<Record<RiskTier, number>> = {
  low: 12,
  medium: 6,
  high: 3,
};

/**
 * FDL Art.24 retention period in years. Every customer record must
 * be preserved for at least 10 years after the relationship ends.
 */
export const RECORD_RETENTION_YEARS = 10;

/**
 * Expiry alert windows in days. When an attached document's expiry
 * date falls within any of these windows, the expiry alerter emits
 * an Asana task. Multiple windows let the MLRO see early (90d),
 * mid (60d), and urgent (30d/7d) reminders.
 */
export const EXPIRY_ALERT_WINDOWS_DAYS: readonly number[] = [90, 60, 30, 7] as const;

// ---------------------------------------------------------------------------
// Pure helpers — date arithmetic used by validator + alerter
// ---------------------------------------------------------------------------

/**
 * Parse a dd/mm/yyyy string into a Date. Returns `null` if the format
 * is invalid (e.g. `"13/25/2026"` or `"not-a-date"`).
 *
 * Strict parser — rejects any variation (no dashes, no ISO, no
 * leading/trailing whitespace after trim). Month and day must be
 * zero-padded or single-digit (1-12, 1-31). Year must be 4 digits.
 */
export function parseDdMmYyyy(value: DateDdMmYyyy | undefined | null): Date | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!m) return null;
  const day = parseInt(m[1]!, 10);
  const month = parseInt(m[2]!, 10);
  const year = parseInt(m[3]!, 10);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  // JavaScript Date constructor takes 0-indexed month.
  const d = new Date(Date.UTC(year, month - 1, day));
  // Reject if the Date constructor silently rolled over an invalid
  // day-of-month (e.g. 31/02/2026 → 3rd March).
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

/**
 * Format a Date back to the dd/mm/yyyy string used everywhere in the
 * customer profile. Uses UTC components to avoid timezone drift.
 */
export function formatDdMmYyyy(date: Date): DateDdMmYyyy {
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Compute the number of whole days between two dates (floor of the
 * absolute difference). Used by the expiry alerter to match a date
 * against the alert windows.
 */
export function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
}

/**
 * Add N years to a date (calendar years, preserving month and day).
 * Used by `createdAt + 10yr` retention computation and by periodic
 * review scheduling.
 */
export function addYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

/**
 * Add N months to a date. Handles month-end edge cases (e.g.
 * 31/01 + 1 month = 28/02, not invalid).
 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const targetMonth = d.getUTCMonth() + months;
  d.setUTCDate(1); // avoid rollover
  d.setUTCMonth(targetMonth);
  // Clamp day to last valid day of the target month.
  const daysInTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const originalDay = date.getUTCDate();
  d.setUTCDate(Math.min(originalDay, daysInTarget));
  return d;
}

// ---------------------------------------------------------------------------
// UBO classification
// ---------------------------------------------------------------------------

/**
 * Classify a shareholder as a UBO based on the ownership threshold.
 * Pure — takes a shareholder record and returns the boolean. The
 * orchestrator uses this to populate the `isUbo` projection in the
 * UI layer; the validator uses it to enforce that every UBO has
 * the UBO-specific evidence fields populated.
 */
export function isShareholderUbo(s: ShareholderRecord): boolean {
  return s.ownershipPercent >= UBO_OWNERSHIP_THRESHOLD_PERCENT;
}

/**
 * Return the subset of shareholders classified as UBOs. Used by the
 * UBO register view and by the Cabinet Decision 109/2023 compliance
 * report.
 */
export function extractUbos(
  shareholders: readonly ShareholderRecord[]
): readonly ShareholderRecord[] {
  return shareholders.filter(isShareholderUbo);
}

/**
 * Compute the next periodic review deadline for a customer based on
 * their risk tier. Pure — takes the current review date and tier,
 * returns the next due date.
 */
export function computeNextReviewDue(lastReviewDate: Date, tier: RiskTier): Date {
  return addMonths(lastReviewDate, PERIODIC_REVIEW_MONTHS[tier]);
}

/**
 * Compute the record retention deadline per FDL Art.24.
 */
export function computeRetentionUntil(createdAt: Date): Date {
  return addYears(createdAt, RECORD_RETENTION_YEARS);
}
