/**
 * Tests for src/services/expiryAsanaEmitter.ts + the cron
 * validator from netlify/functions/expiry-scan-cron.mts.
 */
import { describe, expect, it } from 'vitest';
import type { ExpiryAlert } from '../src/services/customerExpiryAlerter';
import {
  KYC_CDD_SECTION_DOCUMENT_COLLECTION,
  KYC_CDD_SECTION_PERIODIC_REVIEWS,
  KYC_CDD_SECTION_UBO_PENDING,
  buildExpiryEmitReport,
  draftTaskFromAlert,
  draftTasksFromAlerts,
  sectionForExpiryKind,
} from '../src/services/expiryAsanaEmitter';
import { __test__ as cronTest } from '../netlify/functions/expiry-scan-cron.mts';

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function makeAlert(overrides: Partial<ExpiryAlert> = {}): ExpiryAlert {
  return {
    id: 'cust-1:licence:self:01/01/2027',
    customerId: 'cust-1',
    customerLegalName: 'NAPLES JEWELLERY TRADING L.L.C',
    kind: 'licence',
    subjectId: '',
    subjectName: 'NAPLES JEWELLERY TRADING L.L.C',
    expiryDate: '01/01/2027',
    daysUntilExpiry: 60,
    severity: 'upcoming',
    windowDays: 60,
    regulatory: 'MoE Circular 08/AML/2021',
    message: 'Trade licence expires soon',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sectionForExpiryKind
// ---------------------------------------------------------------------------

describe('sectionForExpiryKind', () => {
  it.each([
    ['licence', KYC_CDD_SECTION_PERIODIC_REVIEWS],
    ['risk-rating-expiry', KYC_CDD_SECTION_PERIODIC_REVIEWS],
    ['periodic-review', KYC_CDD_SECTION_PERIODIC_REVIEWS],
    ['record-retention', KYC_CDD_SECTION_PERIODIC_REVIEWS],
    ['shareholder-emirates-id', KYC_CDD_SECTION_DOCUMENT_COLLECTION],
    ['shareholder-passport', KYC_CDD_SECTION_DOCUMENT_COLLECTION],
    ['manager-emirates-id', KYC_CDD_SECTION_DOCUMENT_COLLECTION],
    ['manager-passport', KYC_CDD_SECTION_DOCUMENT_COLLECTION],
    ['customer-emirates-id', KYC_CDD_SECTION_DOCUMENT_COLLECTION],
    ['customer-passport', KYC_CDD_SECTION_DOCUMENT_COLLECTION],
    ['ubo-reverification', KYC_CDD_SECTION_UBO_PENDING],
  ] as const)('routes %s → %s', (kind, section) => {
    expect(sectionForExpiryKind(kind)).toBe(section);
  });
});

// ---------------------------------------------------------------------------
// draftTaskFromAlert
// ---------------------------------------------------------------------------

describe('draftTaskFromAlert', () => {
  it('produces a valid draft for an upcoming licence alert', () => {
    const alert = makeAlert();
    const draft = draftTaskFromAlert(alert);
    expect(draft.sectionName).toBe(KYC_CDD_SECTION_PERIODIC_REVIEWS);
    expect(draft.taskName).toMatch(/UPCOMING/);
    expect(draft.taskName).toMatch(/NAPLES/);
    expect(draft.taskName).toMatch(/licence/);
    expect(draft.dueDateDdMmYyyy).toBe('01/01/2027');
    expect(draft.severity).toBe('upcoming');
    expect(draft.tags).toContain('expiry/severity/upcoming');
    expect(draft.tags).toContain('expiry/kind/licence');
    expect(draft.idempotencyKey).toBe('expiry:cust-1:licence:self:01/01/2027');
    expect(draft.sourceAlertId).toBe(alert.id);
  });

  it('uses EXPIRED prefix when severity is expired', () => {
    const alert = makeAlert({ severity: 'expired', daysUntilExpiry: -5 });
    const draft = draftTaskFromAlert(alert);
    expect(draft.taskName).toMatch(/EXPIRED/);
    expect(draft.taskBody).toMatch(/IMMEDIATE ACTION REQUIRED/);
  });

  it('uses URGENT prefix for severity=urgent', () => {
    const alert = makeAlert({ severity: 'urgent', daysUntilExpiry: 3, windowDays: 7 });
    const draft = draftTaskFromAlert(alert);
    expect(draft.taskName).toMatch(/URGENT/);
    expect(draft.taskBody).toMatch(/Contact the customer/);
  });

  it('routes shareholder EID to Document Collection section', () => {
    const alert = makeAlert({
      kind: 'shareholder-emirates-id',
      subjectName: 'Sheikh UBO',
      subjectId: 'sh-1',
    });
    const draft = draftTaskFromAlert(alert);
    expect(draft.sectionName).toBe(KYC_CDD_SECTION_DOCUMENT_COLLECTION);
    expect(draft.taskName).toMatch(/Sheikh UBO/);
  });

  it('routes UBO re-verification to UBO Verification Pending section', () => {
    const alert = makeAlert({
      kind: 'ubo-reverification',
      subjectName: 'UBO Person',
      subjectId: 'sh-1',
    });
    const draft = draftTaskFromAlert(alert);
    expect(draft.sectionName).toBe(KYC_CDD_SECTION_UBO_PENDING);
  });

  it('body contains the regulatory anchor and the expiry date', () => {
    const alert = makeAlert({ regulatory: 'FDL Art.24' });
    const draft = draftTaskFromAlert(alert);
    expect(draft.taskBody).toMatch(/FDL Art.24/);
    expect(draft.taskBody).toMatch(/01\/01\/2027/);
  });

  it('idempotency key matches source alert id prefix', () => {
    const alert = makeAlert({ id: 'cust-1:manager-passport:mgr-1:01/06/2026' });
    const draft = draftTaskFromAlert(alert);
    expect(draft.idempotencyKey).toBe('expiry:cust-1:manager-passport:mgr-1:01/06/2026');
  });
});

// ---------------------------------------------------------------------------
// draftTasksFromAlerts (bulk + dedupe)
// ---------------------------------------------------------------------------

describe('draftTasksFromAlerts', () => {
  it('returns empty for empty input', () => {
    expect(draftTasksFromAlerts([])).toEqual([]);
  });

  it('dedupes by idempotency key', () => {
    const alerts = [makeAlert(), makeAlert(), makeAlert()];
    const drafts = draftTasksFromAlerts(alerts);
    expect(drafts).toHaveLength(1);
  });

  it('produces one draft per distinct alert', () => {
    const alerts = [
      makeAlert({ id: 'a:licence:self:01/01/2027', kind: 'licence' }),
      makeAlert({
        id: 'a:manager-passport:mgr-1:01/06/2026',
        kind: 'manager-passport',
      }),
      makeAlert({ id: 'a:ubo-reverification:sh-1:01/05/2026', kind: 'ubo-reverification' }),
    ];
    const drafts = draftTasksFromAlerts(alerts);
    expect(drafts).toHaveLength(3);
    const sections = drafts.map((d) => d.sectionName).sort();
    expect(sections).toEqual(
      [
        KYC_CDD_SECTION_DOCUMENT_COLLECTION,
        KYC_CDD_SECTION_PERIODIC_REVIEWS,
        KYC_CDD_SECTION_UBO_PENDING,
      ].sort()
    );
  });
});

// ---------------------------------------------------------------------------
// buildExpiryEmitReport
// ---------------------------------------------------------------------------

describe('buildExpiryEmitReport', () => {
  it('returns a clean summary when empty', () => {
    const report = buildExpiryEmitReport([]);
    expect(report.draftCount).toBe(0);
    expect(report.summary).toMatch(/clean/);
  });

  it('counts by section and by severity', () => {
    const alerts: ExpiryAlert[] = [
      makeAlert({ id: 'a:licence:self:01/01/2027', severity: 'upcoming' }),
      makeAlert({
        id: 'a:manager-passport:mgr-1:01/06/2026',
        kind: 'manager-passport',
        severity: 'urgent',
        daysUntilExpiry: 5,
      }),
      makeAlert({
        id: 'a:shareholder-emirates-id:sh-1:05/04/2026',
        kind: 'shareholder-emirates-id',
        severity: 'expired',
        daysUntilExpiry: -10,
      }),
      makeAlert({
        id: 'a:ubo-reverification:sh-1:01/05/2026',
        kind: 'ubo-reverification',
        severity: 'soon',
        daysUntilExpiry: 15,
      }),
    ];
    const report = buildExpiryEmitReport(alerts);
    expect(report.draftCount).toBe(4);
    expect(report.bySeverity.expired).toBe(1);
    expect(report.bySeverity.urgent).toBe(1);
    expect(report.bySeverity.soon).toBe(1);
    expect(report.bySeverity.upcoming).toBe(1);
    expect(report.bySection[KYC_CDD_SECTION_PERIODIC_REVIEWS]).toBe(1);
    expect(report.bySection[KYC_CDD_SECTION_DOCUMENT_COLLECTION]).toBe(2);
    expect(report.bySection[KYC_CDD_SECTION_UBO_PENDING]).toBe(1);
    expect(report.summary).toMatch(/4 expiry task/);
  });
});

// ---------------------------------------------------------------------------
// expiry-scan-cron validateRequest
// ---------------------------------------------------------------------------

describe('expiry-scan-cron validateRequest', () => {
  const { validateRequest } = cronTest;

  it('accepts an empty body (scheduled-function path)', () => {
    expect(validateRequest({}).ok).toBe(true);
    expect(validateRequest(null).ok).toBe(true);
  });

  it('accepts dispatch=true/false', () => {
    const a = validateRequest({ dispatch: true });
    const b = validateRequest({ dispatch: false });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.ok && a.req.dispatch).toBe(true);
    expect(b.ok && b.req.dispatch).toBe(false);
  });

  it('rejects non-boolean dispatch', () => {
    expect(validateRequest({ dispatch: 'yes' }).ok).toBe(false);
  });

  it('accepts a valid asOfIso', () => {
    const r = validateRequest({ asOfIso: '2026-04-15T10:00:00.000Z' });
    expect(r.ok).toBe(true);
  });

  it('rejects a broken asOfIso', () => {
    expect(validateRequest({ asOfIso: 'tomorrow' }).ok).toBe(false);
    expect(validateRequest({ asOfIso: 42 }).ok).toBe(false);
  });
});
