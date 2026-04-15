/**
 * Customer Expiry Alerter — pure expiry detection that walks a list
 * of CustomerProfileV2 records and returns a prioritised list of
 * expiring documents bucketed by alert window (90d / 60d / 30d / 7d).
 *
 * Why this exists:
 *   The MLRO cannot track expiring licences, Emirates IDs, passports,
 *   UBO re-verification deadlines, and periodic review schedules by
 *   hand across 6+ entities × N shareholders × N managers. Without a
 *   single "what is expiring next" report, critical documents slip
 *   past their deadline and become MoE inspection findings.
 *
 *   This module is the pure engine. It takes a list of profiles +
 *   today's date and returns every expiring artefact, sorted by
 *   urgency. The cron wrapper (a future Netlify scheduled function)
 *   consumes this and creates Asana tasks in the correct KYC/CDD
 *   Tracker section ("Periodic Reviews Due", "Document Collection —
 *   Awaiting Customer", etc.).
 *
 *   Pure. No I/O, no state. Deterministic — same input → same output.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO continuous oversight)
 *   FDL No.10/2025 Art.24    (10yr retention — expiring records
 *                              trigger refresh, not deletion)
 *   Cabinet Res 134/2025 Art.19 (periodic review cadence)
 *   Cabinet Decision 109/2023    (UBO re-verification 15 working days)
 *   MoE Circular 08/AML/2021     (DPMS licence validity)
 */

import {
  type CustomerProfileV2,
  type ManagerRecord,
  type ShareholderRecord,
  type DateDdMmYyyy,
  EXPIRY_ALERT_WINDOWS_DAYS,
  daysBetween,
  parseDdMmYyyy,
} from '../domain/customerProfile';

// ---------------------------------------------------------------------------
// Alert types
// ---------------------------------------------------------------------------

export type ExpiryArtefactKind =
  | 'licence'
  | 'customer-emirates-id'
  | 'customer-passport'
  | 'shareholder-emirates-id'
  | 'shareholder-passport'
  | 'manager-emirates-id'
  | 'manager-passport'
  | 'ubo-reverification'
  | 'periodic-review'
  | 'risk-rating-expiry'
  | 'record-retention';

export type ExpirySeverity = 'expired' | 'urgent' | 'soon' | 'upcoming';

export interface ExpiryAlert {
  /** Stable id built from customerId + kind + subjectId + expiryDate. */
  readonly id: string;
  readonly customerId: string;
  readonly customerLegalName: string;
  readonly kind: ExpiryArtefactKind;
  /** id of the shareholder / manager / UBO this alert is about (empty if the customer itself). */
  readonly subjectId: string;
  /** Display name of the subject (customer name, shareholder name, manager name). */
  readonly subjectName: string;
  readonly expiryDate: DateDdMmYyyy;
  /**
   * Days from `asOf` to expiry. Negative if already expired. The
   * sorter uses this ascending so the most urgent alerts appear first.
   */
  readonly daysUntilExpiry: number;
  readonly severity: ExpirySeverity;
  /**
   * Which alert window bucket this entry falls into. `null` if
   * outside every configured window (sanity check — should never
   * happen if the caller filters correctly).
   */
  readonly windowDays: number | null;
  readonly regulatory: string;
  /** Plain-English description for the Asana task body. */
  readonly message: string;
}

export interface ExpiryReport {
  readonly asOfIso: string;
  readonly scannedProfiles: number;
  readonly alerts: readonly ExpiryAlert[];
  /** Count per severity for dashboard rollup. */
  readonly counts: Readonly<Record<ExpirySeverity, number>>;
  readonly summary: string;
  readonly regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Window / severity classification
// ---------------------------------------------------------------------------

/**
 * Returns the tightest alert window that contains `daysUntilExpiry`.
 * For already-expired documents (negative days), returns `null` —
 * the classifier promotes them to severity='expired' directly.
 *
 * Windows are defined in customerProfile.ts as
 * EXPIRY_ALERT_WINDOWS_DAYS. Default: [90, 60, 30, 7].
 */
export function classifyWindow(daysUntilExpiry: number): number | null {
  if (daysUntilExpiry < 0) return null;
  // Sort windows ascending so "tightest (smallest)" wins.
  const sorted = [...EXPIRY_ALERT_WINDOWS_DAYS].sort((a, b) => a - b);
  for (const w of sorted) {
    if (daysUntilExpiry <= w) return w;
  }
  return null;
}

export function classifySeverity(daysUntilExpiry: number): ExpirySeverity | null {
  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 7) return 'urgent';
  if (daysUntilExpiry <= 30) return 'soon';
  if (daysUntilExpiry <= 90) return 'upcoming';
  return null; // outside any alert window
}

// ---------------------------------------------------------------------------
// Pure alert constructors
// ---------------------------------------------------------------------------

function makeAlert(
  customer: CustomerProfileV2,
  kind: ExpiryArtefactKind,
  subjectId: string,
  subjectName: string,
  expiryDate: DateDdMmYyyy,
  asOf: Date,
  regulatory: string,
  messagePrefix: string
): ExpiryAlert | null {
  const parsed = parseDdMmYyyy(expiryDate);
  if (parsed === null) return null;
  const daysUntilExpiry = daysBetween(asOf, parsed);
  const severity = classifySeverity(daysUntilExpiry);
  if (severity === null) return null; // outside window, don't alert
  const windowDays = classifyWindow(daysUntilExpiry);
  const id = `${customer.id}:${kind}:${subjectId || 'self'}:${expiryDate}`;
  const whenPhrase =
    daysUntilExpiry < 0
      ? `expired ${Math.abs(daysUntilExpiry)} day(s) ago`
      : `expires in ${daysUntilExpiry} day(s)`;
  return {
    id,
    customerId: customer.id,
    customerLegalName: customer.legalName,
    kind,
    subjectId,
    subjectName,
    expiryDate,
    daysUntilExpiry,
    severity,
    windowDays,
    regulatory,
    message: `${messagePrefix} — ${whenPhrase} (${expiryDate})`,
  };
}

// ---------------------------------------------------------------------------
// Per-subject extractors
// ---------------------------------------------------------------------------

function extractCustomerAlerts(c: CustomerProfileV2, asOf: Date, out: ExpiryAlert[]): void {
  const licenceAlert = makeAlert(
    c,
    'licence',
    '',
    c.legalName,
    c.licenseExpiryDate,
    asOf,
    'MoE Circular 08/AML/2021',
    `Trade licence ${c.licenseNumber} for ${c.legalName}`
  );
  if (licenceAlert) out.push(licenceAlert);

  if (c.riskRatingExpiresAt) {
    const riskAlert = makeAlert(
      c,
      'risk-rating-expiry',
      '',
      c.legalName,
      c.riskRatingExpiresAt,
      asOf,
      'Cabinet Res 134/2025 Art.19',
      `Risk rating review (${c.riskRating}) for ${c.legalName}`
    );
    if (riskAlert) out.push(riskAlert);
  }

  if (c.nextReviewDueAt) {
    const reviewAlert = makeAlert(
      c,
      'periodic-review',
      '',
      c.legalName,
      c.nextReviewDueAt,
      asOf,
      'Cabinet Res 134/2025 Art.19',
      `Periodic review due for ${c.legalName} (${c.riskRating} tier)`
    );
    if (reviewAlert) out.push(reviewAlert);
  }

  if (c.recordRetentionUntil) {
    const retentionAlert = makeAlert(
      c,
      'record-retention',
      '',
      c.legalName,
      c.recordRetentionUntil,
      asOf,
      'FDL Art.24',
      `Record retention deadline for ${c.legalName} (10-year period)`
    );
    if (retentionAlert) out.push(retentionAlert);
  }
}

function extractShareholderAlerts(
  c: CustomerProfileV2,
  s: ShareholderRecord,
  asOf: Date,
  out: ExpiryAlert[]
): void {
  if (s.emiratesIdExpiry) {
    const alert = makeAlert(
      c,
      'shareholder-emirates-id',
      s.id,
      s.fullName,
      s.emiratesIdExpiry,
      asOf,
      'FDL Art.12-14',
      `Emirates ID for shareholder ${s.fullName} (${c.legalName})`
    );
    if (alert) out.push(alert);
  }
  if (s.passportExpiry) {
    const alert = makeAlert(
      c,
      'shareholder-passport',
      s.id,
      s.fullName,
      s.passportExpiry,
      asOf,
      'FDL Art.12-14',
      `Passport for shareholder ${s.fullName} (${c.legalName})`
    );
    if (alert) out.push(alert);
  }
  if (s.uboReverificationDueAt) {
    const alert = makeAlert(
      c,
      'ubo-reverification',
      s.id,
      s.fullName,
      s.uboReverificationDueAt,
      asOf,
      'Cabinet Decision 109/2023',
      `UBO re-verification for ${s.fullName} (${c.legalName})`
    );
    if (alert) out.push(alert);
  }
}

function extractManagerAlerts(
  c: CustomerProfileV2,
  m: ManagerRecord,
  asOf: Date,
  out: ExpiryAlert[]
): void {
  if (m.emiratesIdExpiry) {
    const alert = makeAlert(
      c,
      'manager-emirates-id',
      m.id,
      m.fullName,
      m.emiratesIdExpiry,
      asOf,
      'FDL Art.12-14',
      `Emirates ID for manager ${m.fullName} (${c.legalName}, role=${m.role})`
    );
    if (alert) out.push(alert);
  }
  // Manager passport is always required — always check expiry.
  const alert = makeAlert(
    c,
    'manager-passport',
    m.id,
    m.fullName,
    m.passportExpiry,
    asOf,
    'FDL Art.12-14',
    `Passport for manager ${m.fullName} (${c.legalName}, role=${m.role})`
  );
  if (alert) out.push(alert);
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Walk every customer in the list, emit an alert for every artefact
 * whose expiry date falls inside an alert window (default
 * [90, 60, 30, 7] days) or is already expired. Pure function.
 *
 * Sort order: by daysUntilExpiry ascending, so most-urgent (most-
 * negative for already-expired, smallest positive for upcoming)
 * appears first.
 */
export function scanExpiries(
  customers: readonly CustomerProfileV2[],
  asOf: Date = new Date()
): ExpiryReport {
  const alerts: ExpiryAlert[] = [];

  for (const c of customers) {
    extractCustomerAlerts(c, asOf, alerts);
    for (const s of c.shareholders ?? []) {
      extractShareholderAlerts(c, s, asOf, alerts);
    }
    for (const m of c.managers ?? []) {
      extractManagerAlerts(c, m, asOf, alerts);
    }
  }

  alerts.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  const counts: Record<ExpirySeverity, number> = {
    expired: 0,
    urgent: 0,
    soon: 0,
    upcoming: 0,
  };
  for (const a of alerts) counts[a.severity]++;

  const summary =
    alerts.length === 0
      ? `No expiring documents in the next ${Math.max(...EXPIRY_ALERT_WINDOWS_DAYS)} days across ${customers.length} customer(s).`
      : `${alerts.length} expiring artefact(s) across ${customers.length} customer(s): ${counts.expired} expired, ${counts.urgent} urgent (≤7d), ${counts.soon} soon (≤30d), ${counts.upcoming} upcoming (≤90d).`;

  return {
    asOfIso: asOf.toISOString(),
    scannedProfiles: customers.length,
    alerts,
    counts,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'FDL No.10/2025 Art.24',
      'Cabinet Res 134/2025 Art.19',
      'Cabinet Decision 109/2023',
      'MoE Circular 08/AML/2021',
    ],
  };
}
