/**
 * Customer Profile Validator — pure structural + regulatory validator
 * for CustomerProfileV2 records. Runs at the system boundary (HTTP
 * ingress, UI save, CSV import) so every downstream consumer can
 * trust the shape.
 *
 * Why this exists:
 *   The v2 profile has ~40 fields. A React form cannot enforce all
 *   the cross-field invariants (ownership summing ≤100, UBO threshold
 *   implies evidence present, licence status must match licence
 *   expiry date, every natural-person manager must have a passport
 *   expiry in the future, etc.). Those invariants live here.
 *
 *   Pure function. No I/O, no state, no network. Returns a structured
 *   report with per-field findings so the UI can render inline error
 *   messages AND the audit log can record exactly which rule fired.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12-14 (every CDD field is mandatory)
 *   FDL No.10/2025 Art.24    (10yr retention — validated records only)
 *   Cabinet Res 134/2025 Art.7-10 (CDD data collection per tier)
 *   Cabinet Res 134/2025 Art.14   (EDD + PEP senior/board approval)
 *   Cabinet Decision 109/2023     (UBO register, >25% threshold,
 *                                   15-working-day re-verification)
 *   MoE Circular 08/AML/2021      (DPMS licence validity check)
 *   FATF Rec 10 (CDD), Rec 12 (PEP)
 */

import {
  type CustomerProfileV2,
  type ManagerRecord,
  type ShareholderRecord,
  type DateDdMmYyyy,
  type EmiratesIdNumber,
  UBO_OWNERSHIP_THRESHOLD_PERCENT,
  parseDdMmYyyy,
  isShareholderUbo,
} from '../domain/customerProfile';

// ---------------------------------------------------------------------------
// Finding types
// ---------------------------------------------------------------------------

export type FindingSeverity = 'blocker' | 'warning' | 'info';

export interface ValidationFinding {
  /** Dot-path into the profile e.g. "managers[2].passportExpiry". */
  readonly path: string;
  readonly severity: FindingSeverity;
  readonly message: string;
  readonly regulatory: string;
}

export interface ValidationReport {
  readonly ok: boolean;
  readonly blockerCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly findings: readonly ValidationFinding[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * UAE Emirates ID format: 784-YYYY-NNNNNNN-N. Strict validator —
 * rejects anything that doesn't match the four-group pattern with
 * hyphens. The 784 prefix is the UAE ISD code and is mandatory.
 */
export function isValidEmiratesId(value: EmiratesIdNumber | undefined | null): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return /^784-\d{4}-\d{7}-\d$/.test(trimmed);
}

/**
 * ISO-3166 alpha-2 shape check — exactly 2 uppercase letters.
 * Does NOT validate against the full ISO list (that would be a
 * 250-entry lookup table), but catches 99% of operator typos.
 */
export function isValidCountryCode(value: string | undefined | null): boolean {
  if (typeof value !== 'string') return false;
  return /^[A-Z]{2}$/.test(value.trim());
}

/** Returns true if the given dd/mm/yyyy date is strictly in the past. */
export function isExpired(date: DateDdMmYyyy | undefined | null, asOf: Date): boolean {
  const parsed = parseDdMmYyyy(date);
  if (parsed === null) return false;
  return parsed.getTime() < asOf.getTime();
}

/** Returns true if the given dd/mm/yyyy date is strictly in the future. */
export function isInFuture(date: DateDdMmYyyy | undefined | null, asOf: Date): boolean {
  const parsed = parseDdMmYyyy(date);
  if (parsed === null) return false;
  return parsed.getTime() > asOf.getTime();
}

// ---------------------------------------------------------------------------
// Finding accumulator
// ---------------------------------------------------------------------------

class FindingAccumulator {
  readonly findings: ValidationFinding[] = [];

  blocker(path: string, message: string, regulatory: string): void {
    this.findings.push({ path, severity: 'blocker', message, regulatory });
  }

  warning(path: string, message: string, regulatory: string): void {
    this.findings.push({ path, severity: 'warning', message, regulatory });
  }

  info(path: string, message: string, regulatory: string): void {
    this.findings.push({ path, severity: 'info', message, regulatory });
  }
}

// ---------------------------------------------------------------------------
// Individual validators
// ---------------------------------------------------------------------------

function validateIdentity(p: CustomerProfileV2, acc: FindingAccumulator): void {
  if (!p.id || p.id.trim().length === 0) {
    acc.blocker('id', 'Customer id is required', 'FDL Art.12-14');
  }
  if (!p.legalName || p.legalName.trim().length === 0) {
    acc.blocker('legalName', 'Legal name is required', 'FDL Art.12-14');
  }
  if (p.customerType !== 'natural' && p.customerType !== 'legal') {
    acc.blocker('customerType', 'customerType must be "natural" or "legal"', 'FDL Art.12-14');
  }
}

function validateRegistration(p: CustomerProfileV2, acc: FindingAccumulator, asOf: Date): void {
  if (!isValidCountryCode(p.country)) {
    acc.blocker(
      'country',
      `country must be ISO-3166 alpha-2 (e.g. "AE"), got "${p.country}"`,
      'FDL Art.12-14'
    );
  }
  if (!p.jurisdiction || p.jurisdiction.trim().length === 0) {
    acc.blocker('jurisdiction', 'jurisdiction is required', 'FDL Art.12');
  }
  if (!p.licenseNumber || p.licenseNumber.trim().length === 0) {
    acc.blocker('licenseNumber', 'licenseNumber is required', 'MoE Circular 08/AML/2021');
  }
  if (!p.licenseIssuer || p.licenseIssuer.trim().length === 0) {
    acc.blocker('licenseIssuer', 'licenseIssuer is required', 'MoE Circular 08/AML/2021');
  }

  const issueDate = parseDdMmYyyy(p.licenseIssueDate);
  if (issueDate === null) {
    acc.blocker(
      'licenseIssueDate',
      `licenseIssueDate must be dd/mm/yyyy, got "${p.licenseIssueDate}"`,
      'FDL Art.12'
    );
  }
  const expiryDate = parseDdMmYyyy(p.licenseExpiryDate);
  if (expiryDate === null) {
    acc.blocker(
      'licenseExpiryDate',
      `licenseExpiryDate must be dd/mm/yyyy, got "${p.licenseExpiryDate}"`,
      'MoE Circular 08/AML/2021'
    );
  }

  // Cross-field: issue date must be before expiry date
  if (issueDate && expiryDate && issueDate.getTime() >= expiryDate.getTime()) {
    acc.blocker(
      'licenseExpiryDate',
      'licenseExpiryDate must be strictly after licenseIssueDate',
      'FDL Art.12'
    );
  }

  // Cross-field: licenseStatus must match actual expiry
  if (expiryDate) {
    const isPastExpiry = expiryDate.getTime() < asOf.getTime();
    if (isPastExpiry && p.licenseStatus === 'active') {
      acc.blocker(
        'licenseStatus',
        'licenseStatus is "active" but licenseExpiryDate is in the past — update to "expired"',
        'MoE Circular 08/AML/2021'
      );
    }
  }
}

function validateBusiness(p: CustomerProfileV2, acc: FindingAccumulator): void {
  if (!p.businessModel || p.businessModel.trim().length < 10) {
    acc.warning(
      'businessModel',
      'businessModel should be at least 10 characters of plain-language description',
      'Cabinet Res 134/2025 Art.7-10'
    );
  }
  if (!p.activity || p.activity.trim().length === 0) {
    acc.blocker('activity', 'activity is required', 'FDL Art.12-14');
  }
  if (typeof p.expectedMonthlyVolumeAed !== 'number' || p.expectedMonthlyVolumeAed < 0) {
    acc.blocker(
      'expectedMonthlyVolumeAed',
      'expectedMonthlyVolumeAed must be a non-negative number',
      'Cabinet Res 134/2025 Art.7-10'
    );
  }
  if (
    typeof p.expectedTransactionCountPerMonth !== 'number' ||
    p.expectedTransactionCountPerMonth < 0
  ) {
    acc.blocker(
      'expectedTransactionCountPerMonth',
      'expectedTransactionCountPerMonth must be a non-negative number',
      'Cabinet Res 134/2025 Art.7-10'
    );
  }
}

function validateRiskPosture(p: CustomerProfileV2, acc: FindingAccumulator): void {
  const validTiers = ['low', 'medium', 'high'] as const;
  if (!validTiers.includes(p.riskRating)) {
    acc.blocker('riskRating', 'riskRating must be low/medium/high', 'Cabinet Res 134/2025 Art.5');
  }
  if (parseDdMmYyyy(p.riskRatingAssignedAt) === null) {
    acc.blocker(
      'riskRatingAssignedAt',
      `riskRatingAssignedAt must be dd/mm/yyyy, got "${p.riskRatingAssignedAt}"`,
      'Cabinet Res 134/2025 Art.19'
    );
  }
  if (parseDdMmYyyy(p.riskRatingExpiresAt) === null) {
    acc.blocker(
      'riskRatingExpiresAt',
      `riskRatingExpiresAt must be dd/mm/yyyy, got "${p.riskRatingExpiresAt}"`,
      'Cabinet Res 134/2025 Art.19'
    );
  }
}

function validateSourceOfFunds(p: CustomerProfileV2, acc: FindingAccumulator): void {
  if (
    p.sourceOfFundsStatus === 'verified' &&
    (!p.sourceOfFundsEvidence || p.sourceOfFundsEvidence.length === 0)
  ) {
    acc.blocker(
      'sourceOfFundsEvidence',
      'sourceOfFundsStatus is "verified" but no evidence attachments are present',
      'FDL Art.14'
    );
  }
  if (p.riskRating === 'high' && p.sourceOfWealthStatus === 'pending') {
    acc.warning(
      'sourceOfWealthStatus',
      'High-risk customer must have source-of-wealth verified per Cabinet Res 134/2025 Art.14',
      'Cabinet Res 134/2025 Art.14'
    );
  }
  if (
    p.sourceOfWealthStatus === 'verified' &&
    (!p.sourceOfWealthEvidence || p.sourceOfWealthEvidence.length === 0)
  ) {
    acc.blocker(
      'sourceOfWealthEvidence',
      'sourceOfWealthStatus is "verified" but no evidence attachments are present',
      'Cabinet Res 134/2025 Art.14'
    );
  }
}

function validateShareholders(
  shareholders: readonly ShareholderRecord[],
  acc: FindingAccumulator,
  asOf: Date
): void {
  // Rule 1: total ownership cannot exceed 100%
  const totalOwnership = shareholders.reduce((sum, s) => sum + (s.ownershipPercent ?? 0), 0);
  if (totalOwnership > 100.01) {
    // 0.01 tolerance for rounding
    acc.blocker(
      'shareholders',
      `Total shareholder ownership is ${totalOwnership.toFixed(2)}%, must be ≤100%`,
      'Cabinet Decision 109/2023'
    );
  }

  // Rule 2: per-shareholder checks
  shareholders.forEach((s, idx) => {
    const path = `shareholders[${idx}]`;
    if (!s.id || s.id.trim().length === 0) {
      acc.blocker(`${path}.id`, 'shareholder id is required', 'Cabinet Decision 109/2023');
    }
    if (!s.fullName || s.fullName.trim().length === 0) {
      acc.blocker(
        `${path}.fullName`,
        'shareholder fullName is required',
        'Cabinet Decision 109/2023'
      );
    }
    if (
      typeof s.ownershipPercent !== 'number' ||
      s.ownershipPercent < 0 ||
      s.ownershipPercent > 100
    ) {
      acc.blocker(
        `${path}.ownershipPercent`,
        'ownershipPercent must be a number 0..100',
        'Cabinet Decision 109/2023'
      );
    }

    if (s.type === 'natural') {
      if (!s.nationality || !isValidCountryCode(s.nationality)) {
        acc.blocker(
          `${path}.nationality`,
          'nationality is required (ISO-3166 alpha-2) for natural-person shareholders',
          'FDL Art.12-14'
        );
      }
      if (!s.dateOfBirth || parseDdMmYyyy(s.dateOfBirth) === null) {
        acc.blocker(
          `${path}.dateOfBirth`,
          'dateOfBirth (dd/mm/yyyy) is required for natural-person shareholders',
          'FDL Art.12-14'
        );
      }
      // Emirates ID: required IF the shareholder is UAE national
      if (s.nationality === 'AE') {
        if (!s.emiratesIdNumber || !isValidEmiratesId(s.emiratesIdNumber)) {
          acc.blocker(
            `${path}.emiratesIdNumber`,
            'UAE-national shareholders must have a valid Emirates ID (784-YYYY-NNNNNNN-N)',
            'FDL Art.12-14'
          );
        }
        if (!s.emiratesIdExpiry || parseDdMmYyyy(s.emiratesIdExpiry) === null) {
          acc.blocker(
            `${path}.emiratesIdExpiry`,
            'Emirates ID expiry date is required',
            'FDL Art.12-14'
          );
        } else if (isExpired(s.emiratesIdExpiry, asOf)) {
          acc.warning(
            `${path}.emiratesIdExpiry`,
            `Emirates ID expired on ${s.emiratesIdExpiry}`,
            'FDL Art.12-14'
          );
        }
      }
      // Passport: required for non-UAE nationals
      if (s.nationality && s.nationality !== 'AE') {
        if (!s.passportNumber) {
          acc.blocker(
            `${path}.passportNumber`,
            'Non-UAE-national shareholders must have a passport number',
            'FDL Art.12-14'
          );
        }
        if (!s.passportExpiry || parseDdMmYyyy(s.passportExpiry) === null) {
          acc.blocker(
            `${path}.passportExpiry`,
            'Passport expiry date is required',
            'FDL Art.12-14'
          );
        } else if (isExpired(s.passportExpiry, asOf)) {
          acc.warning(
            `${path}.passportExpiry`,
            `Passport expired on ${s.passportExpiry}`,
            'FDL Art.12-14'
          );
        }
      }
    } else if (s.type === 'legal') {
      if (!s.registrationCountry || !isValidCountryCode(s.registrationCountry)) {
        acc.blocker(
          `${path}.registrationCountry`,
          'registrationCountry is required for legal-entity shareholders',
          'Cabinet Decision 109/2023'
        );
      }
      if (!s.registrationNumber) {
        acc.blocker(
          `${path}.registrationNumber`,
          'registrationNumber is required for legal-entity shareholders',
          'Cabinet Decision 109/2023'
        );
      }
    }

    // UBO-specific rules (Cabinet Decision 109/2023)
    if (isShareholderUbo(s)) {
      if (!s.uboVerifiedAt) {
        acc.blocker(
          `${path}.uboVerifiedAt`,
          `Shareholder owns ≥${UBO_OWNERSHIP_THRESHOLD_PERCENT}% and must have a UBO verification date`,
          'Cabinet Decision 109/2023'
        );
      }
      // PEP status is always decided (clear/potential/confirmed) — no
      // "pending" variant in the type. A 'potential' PEP UBO warrants
      // a flag because Board approval becomes mandatory if confirmed.
      if (s.pepCheckStatus === 'potential') {
        acc.warning(
          `${path}.pepCheckStatus`,
          'UBO shareholder flagged as potential PEP — escalate for Board approval determination',
          'FATF Rec 12'
        );
      }
      if (s.sanctionsCheckStatus === 'pending') {
        acc.warning(
          `${path}.sanctionsCheckStatus`,
          'UBO shareholder still has sanctions check pending',
          'FDL Art.35'
        );
      }
      if (!s.evidenceAttachments || s.evidenceAttachments.length === 0) {
        acc.warning(
          `${path}.evidenceAttachments`,
          'UBO shareholder should have at least one evidence attachment (ID, registration, etc.)',
          'Cabinet Decision 109/2023'
        );
      }
    }
  });

  // Rule 3: at least one UBO if there are any shareholders
  if (shareholders.length > 0 && !shareholders.some(isShareholderUbo)) {
    acc.warning(
      'shareholders',
      'No shareholder owns ≥25% — confirm this is deliberate (flat ownership) and identify the ultimate natural-person UBO via parent chain',
      'Cabinet Decision 109/2023'
    );
  }
}

function validateManagers(
  managers: readonly ManagerRecord[],
  acc: FindingAccumulator,
  asOf: Date
): void {
  if (managers.length === 0) {
    acc.warning(
      'managers',
      'Customer has no managers / directors / authorised signatories recorded',
      'FDL Art.20-22'
    );
    return;
  }

  managers.forEach((m, idx) => {
    const path = `managers[${idx}]`;
    if (!m.id || m.id.trim().length === 0) {
      acc.blocker(`${path}.id`, 'manager id is required', 'FDL Art.20-22');
    }
    if (!m.fullName || m.fullName.trim().length === 0) {
      acc.blocker(`${path}.fullName`, 'manager fullName is required', 'FDL Art.20-22');
    }
    if (!m.nationality || !isValidCountryCode(m.nationality)) {
      acc.blocker(
        `${path}.nationality`,
        'manager nationality is required (ISO-3166 alpha-2)',
        'FDL Art.12-14'
      );
    }
    if (!m.dateOfBirth || parseDdMmYyyy(m.dateOfBirth) === null) {
      acc.blocker(
        `${path}.dateOfBirth`,
        'manager dateOfBirth (dd/mm/yyyy) is required',
        'FDL Art.12-14'
      );
    }
    if (!m.passportNumber || m.passportNumber.trim().length === 0) {
      acc.blocker(`${path}.passportNumber`, 'manager passportNumber is required', 'FDL Art.12-14');
    }
    if (!m.passportExpiry || parseDdMmYyyy(m.passportExpiry) === null) {
      acc.blocker(
        `${path}.passportExpiry`,
        'manager passportExpiry (dd/mm/yyyy) is required',
        'FDL Art.12-14'
      );
    } else if (isExpired(m.passportExpiry, asOf)) {
      acc.blocker(
        `${path}.passportExpiry`,
        `manager passport expired on ${m.passportExpiry} — cannot act for the entity`,
        'FDL Art.12-14'
      );
    }
    // If UAE national, require valid Emirates ID
    if (m.nationality === 'AE') {
      if (!m.emiratesIdNumber || !isValidEmiratesId(m.emiratesIdNumber)) {
        acc.blocker(
          `${path}.emiratesIdNumber`,
          'UAE-national manager must have a valid Emirates ID (784-YYYY-NNNNNNN-N)',
          'FDL Art.12-14'
        );
      }
      if (m.emiratesIdExpiry && isExpired(m.emiratesIdExpiry, asOf)) {
        acc.warning(
          `${path}.emiratesIdExpiry`,
          `manager Emirates ID expired on ${m.emiratesIdExpiry}`,
          'FDL Art.12-14'
        );
      }
    }
    if (!m.appointmentDate || parseDdMmYyyy(m.appointmentDate) === null) {
      acc.blocker(
        `${path}.appointmentDate`,
        'manager appointmentDate (dd/mm/yyyy) is required',
        'Cabinet Res 134/2025 Art.19'
      );
    }
  });

  // Require at least one MLRO + one CO for Cabinet Res 134/2025 Art.19 compliance
  const hasMlro = managers.some((m) => m.role === 'mlro');
  const hasCo = managers.some((m) => m.role === 'co');
  if (!hasMlro) {
    acc.warning(
      'managers',
      'No manager with role "mlro" — FDL Art.20-22 requires a designated MLRO',
      'FDL Art.20-22'
    );
  }
  if (!hasCo) {
    acc.warning(
      'managers',
      'No manager with role "co" — FDL Art.20-22 requires a designated Compliance Officer',
      'FDL Art.20-22'
    );
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Validate a CustomerProfileV2 record. Pure function.
 *
 * @param profile  The profile to validate (shape is trusted as V2).
 * @param asOf     The "current time" against which expiry dates are
 *                 checked. Tests inject a fixed date for determinism.
 */
export function validateCustomerProfile(
  profile: CustomerProfileV2,
  asOf: Date = new Date()
): ValidationReport {
  const acc = new FindingAccumulator();

  validateIdentity(profile, acc);
  validateRegistration(profile, acc, asOf);
  validateBusiness(profile, acc);
  validateRiskPosture(profile, acc);
  validateSourceOfFunds(profile, acc);
  validateShareholders(profile.shareholders ?? [], acc, asOf);
  validateManagers(profile.managers ?? [], acc, asOf);

  const blockerCount = acc.findings.filter((f) => f.severity === 'blocker').length;
  const warningCount = acc.findings.filter((f) => f.severity === 'warning').length;
  const infoCount = acc.findings.filter((f) => f.severity === 'info').length;

  return {
    ok: blockerCount === 0,
    blockerCount,
    warningCount,
    infoCount,
    findings: acc.findings,
  };
}
