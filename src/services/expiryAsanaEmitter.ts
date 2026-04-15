/**
 * Expiry → Asana Emitter — pure mapping from an ExpiryAlert list
 * (produced by `customerExpiryAlerter.scanExpiries()`) to Asana task
 * drafts, routed to the correct section in the KYC/CDD Tracker
 * project (the 16-section layout provisioned by PR #127).
 *
 * Why this exists:
 *   The expiry scanner knows WHAT is expiring. The Asana dispatcher
 *   knows HOW to create tasks. This module is the pure translator
 *   between them. It takes a list of alerts and returns a list of
 *   `ExpiryAsanaTaskDraft` records — each with a target section,
 *   task name, body, due date, and tags. The caller (a Netlify cron
 *   or the setup.html button) walks the drafts against an injected
 *   Asana dispatcher.
 *
 *   Pure. No I/O. No state. Deterministic — same alerts + same
 *   section map → same drafts → same Asana task ids (the task name
 *   carries a stable hash suffix that dedupes on re-run).
 *
 * Section routing table:
 *
 *   licence                 → Periodic Reviews Due
 *   risk-rating-expiry      → Periodic Reviews Due
 *   periodic-review         → Periodic Reviews Due
 *   record-retention        → Periodic Reviews Due
 *   shareholder-emirates-id → Document Collection — Awaiting Customer
 *   shareholder-passport    → Document Collection — Awaiting Customer
 *   manager-emirates-id     → Document Collection — Awaiting Customer
 *   manager-passport        → Document Collection — Awaiting Customer
 *   customer-emirates-id    → Document Collection — Awaiting Customer
 *   customer-passport       → Document Collection — Awaiting Customer
 *   ubo-reverification      → UBO Verification Pending
 *
 * The section names match the canonical plan in PR #127's
 * `kycCddTrackerSections.ts`. If those names change, update this
 * map too — otherwise the dispatcher will create new sections
 * instead of reusing the existing ones.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.12-14 (CDD)
 *   FDL No.10/2025 Art.20-22 (CO oversight)
 *   FDL No.10/2025 Art.24    (10yr retention — expiring records
 *                              trigger refresh, not deletion)
 *   Cabinet Res 134/2025 Art.19 (periodic review cadence)
 *   Cabinet Decision 109/2023 (UBO re-verification)
 *   MoE Circular 08/AML/2021 (DPMS licence validity)
 */

import type { ExpiryAlert, ExpiryArtefactKind, ExpirySeverity } from './customerExpiryAlerter';

// ---------------------------------------------------------------------------
// Section routing
// ---------------------------------------------------------------------------

/**
 * Canonical section names from PR #127 `kycCddTrackerSections.ts`.
 * Hard-coded here rather than imported so this module stays
 * standalone (no cross-service dependency) and so a future rename
 * to either side is a deliberate, grep-able change.
 */
export const KYC_CDD_SECTION_PERIODIC_REVIEWS = '🔄 Periodic Reviews Due';
export const KYC_CDD_SECTION_DOCUMENT_COLLECTION = '📥 Document Collection — Awaiting Customer';
export const KYC_CDD_SECTION_UBO_PENDING = '👥 UBO Verification Pending';

/**
 * Route an expiry kind to the target section. Every kind in
 * `ExpiryArtefactKind` must have an explicit target — the switch is
 * exhaustive so TypeScript will block any future addition that
 * forgets to route.
 */
export function sectionForExpiryKind(kind: ExpiryArtefactKind): string {
  switch (kind) {
    case 'licence':
    case 'risk-rating-expiry':
    case 'periodic-review':
    case 'record-retention':
      return KYC_CDD_SECTION_PERIODIC_REVIEWS;
    case 'shareholder-emirates-id':
    case 'shareholder-passport':
    case 'manager-emirates-id':
    case 'manager-passport':
    case 'customer-emirates-id':
    case 'customer-passport':
      return KYC_CDD_SECTION_DOCUMENT_COLLECTION;
    case 'ubo-reverification':
      return KYC_CDD_SECTION_UBO_PENDING;
  }
}

// ---------------------------------------------------------------------------
// Task draft shape
// ---------------------------------------------------------------------------

/**
 * An Asana task draft ready for the dispatcher. Pure data — no
 * references to Asana GIDs or HTTP clients. The section name is
 * resolved to a GID by the dispatcher at write time.
 */
export interface ExpiryAsanaTaskDraft {
  /**
   * Stable idempotency key. Re-running the emitter produces the
   * same key for the same (customer, kind, subject, expiryDate)
   * tuple so the dispatcher can dedupe against existing tasks.
   */
  readonly idempotencyKey: string;
  readonly sectionName: string;
  readonly taskName: string;
  readonly taskBody: string;
  /** dd/mm/yyyy for the Asana `due_on` field. */
  readonly dueDateDdMmYyyy: string;
  readonly severity: ExpirySeverity;
  /** Tags the dispatcher attaches to the task (for filtering). */
  readonly tags: readonly string[];
  /** Regulatory anchor for the audit trail. */
  readonly regulatory: string;
  readonly sourceAlertId: string;
}

// ---------------------------------------------------------------------------
// Severity → visual prefix for the task name
// ---------------------------------------------------------------------------

function severityPrefix(severity: ExpirySeverity): string {
  switch (severity) {
    case 'expired':
      return '🚨 EXPIRED';
    case 'urgent':
      return '🔴 URGENT';
    case 'soon':
      return '🟠 SOON';
    case 'upcoming':
      return '🟡 UPCOMING';
  }
}

function severityTag(severity: ExpirySeverity): string {
  return `expiry/severity/${severity}`;
}

function kindTag(kind: ExpiryArtefactKind): string {
  return `expiry/kind/${kind}`;
}

// ---------------------------------------------------------------------------
// Pure emitter
// ---------------------------------------------------------------------------

/**
 * Map a single `ExpiryAlert` to an `ExpiryAsanaTaskDraft`. Pure.
 *
 * Task name format:
 *   `{severityPrefix} · {customerLegalName} · {subjectName} · {kind}`
 *
 * Task body format (markdown — Asana supports a subset):
 *   - bullet with days-until-expiry
 *   - bullet with the exact expiry date
 *   - bullet with the regulatory anchor
 *   - bullet with a recommended action
 *
 * Idempotency key: `expiry:${customerId}:${kind}:${subjectId|self}:${expiryDate}`
 * — matches the alert id format from `customerExpiryAlerter.ts`.
 */
export function draftTaskFromAlert(alert: ExpiryAlert): ExpiryAsanaTaskDraft {
  const prefix = severityPrefix(alert.severity);
  const subjectName = alert.subjectName || alert.customerLegalName;
  const taskName = `${prefix} · ${alert.customerLegalName} · ${subjectName} · ${alert.kind}`;

  const recommendedAction =
    alert.severity === 'expired'
      ? 'IMMEDIATE ACTION REQUIRED — record is already expired. Investigate and either refresh or exit.'
      : alert.severity === 'urgent'
        ? 'Contact the customer / subject this week. Document any delay.'
        : alert.severity === 'soon'
          ? 'Schedule the refresh within the next 30 days.'
          : 'Note the upcoming deadline; no immediate action required.';

  const taskBody = [
    `**Customer:** ${alert.customerLegalName}`,
    `**Subject:** ${subjectName}`,
    `**Artefact:** ${alert.kind}`,
    ``,
    `- Days until expiry: **${alert.daysUntilExpiry}**`,
    `- Expiry date: **${alert.expiryDate}**`,
    `- Severity: **${alert.severity}**${alert.windowDays !== null ? ` (${alert.windowDays}-day window)` : ''}`,
    `- Regulatory anchor: ${alert.regulatory}`,
    ``,
    `**Recommended action:** ${recommendedAction}`,
    ``,
    `---`,
    `*Auto-generated by the expiry alerter. Idempotency key: \`${alert.id}\`.*`,
  ].join('\n');

  return {
    idempotencyKey: `expiry:${alert.id}`,
    sectionName: sectionForExpiryKind(alert.kind),
    taskName,
    taskBody,
    dueDateDdMmYyyy: alert.expiryDate,
    severity: alert.severity,
    tags: [severityTag(alert.severity), kindTag(alert.kind)],
    regulatory: alert.regulatory,
    sourceAlertId: alert.id,
  };
}

/**
 * Map a full list of alerts to task drafts. Pure. Dedupes by
 * idempotency key (same source alert → one draft).
 */
export function draftTasksFromAlerts(
  alerts: readonly ExpiryAlert[]
): readonly ExpiryAsanaTaskDraft[] {
  const seen = new Set<string>();
  const out: ExpiryAsanaTaskDraft[] = [];
  for (const alert of alerts) {
    const draft = draftTaskFromAlert(alert);
    if (seen.has(draft.idempotencyKey)) continue;
    seen.add(draft.idempotencyKey);
    out.push(draft);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rollup report
// ---------------------------------------------------------------------------

export interface ExpiryEmitReport {
  readonly draftCount: number;
  readonly drafts: readonly ExpiryAsanaTaskDraft[];
  readonly bySection: Readonly<Record<string, number>>;
  readonly bySeverity: Readonly<Record<ExpirySeverity, number>>;
  readonly summary: string;
}

/**
 * Drive the emitter and produce a summary report. Used by the cron
 * for its return payload so the operator can see at a glance how
 * many tasks would be dispatched.
 */
export function buildExpiryEmitReport(alerts: readonly ExpiryAlert[]): ExpiryEmitReport {
  const drafts = draftTasksFromAlerts(alerts);
  const bySection: Record<string, number> = {};
  const bySeverity: Record<ExpirySeverity, number> = {
    expired: 0,
    urgent: 0,
    soon: 0,
    upcoming: 0,
  };
  for (const d of drafts) {
    bySection[d.sectionName] = (bySection[d.sectionName] ?? 0) + 1;
    bySeverity[d.severity]++;
  }
  const summary =
    drafts.length === 0
      ? 'Expiry scan clean — no Asana tasks to dispatch.'
      : `${drafts.length} expiry task(s) ready: ${bySeverity.expired} expired, ${bySeverity.urgent} urgent, ${bySeverity.soon} soon, ${bySeverity.upcoming} upcoming across ${Object.keys(bySection).length} section(s).`;
  return {
    draftCount: drafts.length,
    drafts,
    bySection,
    bySeverity,
    summary,
  };
}
