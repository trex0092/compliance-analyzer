/**
 * Weekly CDD Status Report — unit tests.
 *
 * Covers:
 *   - Tier rollup mirrors risk-rating mapping (FDL Art.12-14).
 *   - Overdue reviews are surfaced; overdue sorts before due-soon.
 *   - Pending Senior Management approvals filter to PEP / EDD /
 *     high-risk onboarding only (Cabinet Res 134/2025 Art.14).
 *   - Filing snapshot counts all filings, marks this-week bucket,
 *     and detects overdue via businessDays.checkDeadline.
 *   - Sanctions resolutions within the 7-day window are surfaced.
 *   - Markdown renderer is deterministic and cites regulations.
 */

import { describe, it, expect } from 'vitest';
import type { CustomerProfile } from '../src/domain/customers';
import type { PeriodicReviewSchedule } from '../src/domain/periodicReview';
import type { ApprovalRequest } from '../src/domain/approvals';
import type { FilingRecord } from '../src/services/screeningComplianceReport';
import type { ScreeningRun } from '../src/domain/screening';
import {
  buildWeeklyCddReport,
  renderWeeklyCddReportMarkdown,
  tierForRiskRating,
} from '../src/services/cddReportGenerator';

const NOW = new Date('2026-04-13T05:00:00.000Z'); // Mon 09:00 Dubai
const DAY_MS = 86_400_000;

function customer(
  id: string,
  rating: CustomerProfile['riskRating']
): CustomerProfile {
  return {
    id,
    legalName: `Co ${id}`,
    type: 'customer',
    riskRating: rating,
    pepStatus: 'clear',
    sanctionsStatus: 'clear',
    sourceOfFundsStatus: 'verified',
    sourceOfWealthStatus: 'verified',
    beneficialOwners: [],
    reviewHistory: [],
  };
}

function schedule(
  customerId: string,
  nextReviewDate: string,
  rating: CustomerProfile['riskRating'] = 'medium'
): PeriodicReviewSchedule {
  return {
    id: `sched-${customerId}`,
    customerId,
    customerName: `Co ${customerId}`,
    riskRating: rating,
    reviewType: 'cdd-refresh',
    frequencyMonths: rating === 'high' ? 3 : rating === 'medium' ? 6 : 12,
    lastReviewDate: new Date(
      NOW.getTime() - 200 * DAY_MS
    ).toISOString(),
    nextReviewDate,
    status: 'scheduled',
  };
}

describe('tierForRiskRating', () => {
  it('maps risk ratings to UAE CDD tiers', () => {
    expect(tierForRiskRating('low')).toBe('SDD');
    expect(tierForRiskRating('medium')).toBe('CDD');
    expect(tierForRiskRating('high')).toBe('EDD');
  });
});

describe('buildWeeklyCddReport — tier rollup', () => {
  it('counts customers by CDD tier', () => {
    const report = buildWeeklyCddReport({
      now: NOW,
      customers: [
        customer('a', 'low'),
        customer('b', 'low'),
        customer('c', 'medium'),
        customer('d', 'high'),
      ],
      reviewSchedules: [],
      approvals: [],
      filings: [],
      screeningRuns: [],
    });
    expect(report.tierRollup).toEqual({
      sdd: 2,
      cdd: 1,
      edd: 1,
      total: 4,
    });
  });
});

describe('buildWeeklyCddReport — overdue reviews', () => {
  it('surfaces overdue + due-soon reviews and orders overdue first', () => {
    const overdueIso = new Date(NOW.getTime() - 10 * DAY_MS).toISOString();
    const dueSoonIso = new Date(NOW.getTime() + 5 * DAY_MS).toISOString();
    const farFutureIso = new Date(NOW.getTime() + 90 * DAY_MS).toISOString();

    const report = buildWeeklyCddReport({
      now: NOW,
      customers: [
        customer('late', 'high'),
        customer('soon', 'medium'),
        customer('clear', 'low'),
      ],
      reviewSchedules: [
        schedule('soon', dueSoonIso, 'medium'),
        schedule('late', overdueIso, 'high'),
        schedule('clear', farFutureIso, 'low'),
      ],
      approvals: [],
      filings: [],
      screeningRuns: [],
    });

    expect(report.overdueReviews).toHaveLength(2);
    expect(report.overdueReviews[0]).toMatchObject({
      customerId: 'late',
      status: 'overdue',
      tier: 'EDD',
    });
    expect(report.overdueReviews[1]).toMatchObject({
      customerId: 'soon',
      status: 'due',
      tier: 'CDD',
    });
  });
});

describe('buildWeeklyCddReport — pending approvals', () => {
  it('includes only PEP / EDD / high-risk onboarding pending approvals', () => {
    const fivedaysAgo = new Date(NOW.getTime() - 5 * DAY_MS).toISOString();
    const approvals: ApprovalRequest[] = [
      {
        id: 'ap1',
        caseId: 'case-pep',
        requiredFor: 'pep-onboarding',
        status: 'pending',
        requestedBy: 'analyst.a',
        requestedAt: fivedaysAgo,
        urgency: 'urgent',
      },
      {
        id: 'ap2',
        caseId: 'case-str',
        requiredFor: 'str-approval',
        status: 'pending',
        requestedBy: 'analyst.a',
        requestedAt: fivedaysAgo,
      },
      {
        id: 'ap3',
        caseId: 'case-edd',
        requiredFor: 'edd-continuation',
        status: 'pending',
        requestedBy: 'analyst.b',
        requestedAt: new Date(NOW.getTime() - 12 * DAY_MS).toISOString(),
      },
      {
        id: 'ap4',
        caseId: 'case-closed',
        requiredFor: 'pep-onboarding',
        status: 'approved',
        requestedBy: 'analyst.a',
        requestedAt: fivedaysAgo,
      },
    ];

    const report = buildWeeklyCddReport({
      now: NOW,
      customers: [],
      reviewSchedules: [],
      approvals,
      filings: [],
      screeningRuns: [],
    });

    // str-approval filtered; approved filtered. Oldest-first ordering.
    expect(report.pendingApprovals.map((p) => p.caseId)).toEqual([
      'case-edd',
      'case-pep',
    ]);
    expect(report.pendingApprovals[0].ageInDays).toBe(12);
  });
});

describe('buildWeeklyCddReport — filing snapshot', () => {
  it('buckets this week, counts by type, and flags overdue via businessDays', () => {
    const threeDaysAgo = new Date(NOW.getTime() - 3 * DAY_MS).toISOString();
    const tenDaysAgo = new Date(NOW.getTime() - 10 * DAY_MS).toISOString();
    const thirtyDaysAgo = new Date(NOW.getTime() - 30 * DAY_MS).toISOString();

    const filings: FilingRecord[] = [
      {
        filingType: 'STR',
        filingDate: threeDaysAgo,
        referenceNumber: 'STR-001',
        status: 'submitted',
        deadlineMet: true,
      },
      {
        filingType: 'CTR',
        filingDate: tenDaysAgo,
        referenceNumber: 'CTR-001',
        status: 'submitted',
        deadlineMet: true,
      },
      {
        // CNMR event 30 days ago, deadline 5 business days, so breached.
        filingType: 'CNMR',
        filingDate: thirtyDaysAgo,
        referenceNumber: 'CNMR-001',
        status: 'pending',
        deadlineMet: true,
      },
      {
        // Explicitly marked overdue by the source system.
        filingType: 'DPMSR',
        filingDate: tenDaysAgo,
        referenceNumber: 'DPMSR-001',
        status: 'overdue',
        deadlineMet: false,
      },
    ];

    const report = buildWeeklyCddReport({
      now: NOW,
      customers: [],
      reviewSchedules: [],
      approvals: [],
      filings,
      screeningRuns: [],
    });

    expect(report.filingSnapshot.countsByType.STR).toBe(1);
    expect(report.filingSnapshot.countsByType.CTR).toBe(1);
    expect(report.filingSnapshot.countsByType.CNMR).toBe(1);
    expect(report.filingSnapshot.countsByType.DPMSR).toBe(1);
    expect(report.filingSnapshot.countsByType.SAR).toBe(0);

    // Only filings within 7 days appear in filedThisWeek.
    expect(report.filingSnapshot.filedThisWeek.map((f) => f.referenceNumber)).toEqual([
      'STR-001',
    ]);

    // CNMR breach + DPMSR explicit overdue.
    const overdueRefs = report.filingSnapshot.overdue.map((o) => o.referenceNumber);
    expect(overdueRefs).toContain('CNMR-001');
    expect(overdueRefs).toContain('DPMSR-001');
    expect(overdueRefs).not.toContain('STR-001');
    expect(overdueRefs).not.toContain('CTR-001');
  });
});

describe('buildWeeklyCddReport — sanctions resolutions', () => {
  it('includes only resolved screening runs within the 7-day window', () => {
    const runs: ScreeningRun[] = [
      {
        id: 'run-1',
        subjectType: 'entity',
        subjectId: 'ent-1',
        executedAt: new Date(NOW.getTime() - 2 * DAY_MS).toISOString(),
        systemUsed: 'refinitiv',
        listsChecked: ['UN', 'OFAC'],
        result: 'potential-match',
        falsePositiveResolution: 'false positive, name collision',
        analyst: 'analyst.a',
      },
      {
        id: 'run-2',
        subjectType: 'ubo',
        subjectId: 'ubo-1',
        executedAt: new Date(NOW.getTime() - 30 * DAY_MS).toISOString(),
        systemUsed: 'refinitiv',
        listsChecked: ['UN', 'OFAC'],
        result: 'potential-match',
        falsePositiveResolution: 'false positive',
        analyst: 'analyst.a',
      },
      {
        id: 'run-3',
        subjectType: 'entity',
        subjectId: 'ent-2',
        executedAt: new Date(NOW.getTime() - 1 * DAY_MS).toISOString(),
        systemUsed: 'refinitiv',
        listsChecked: ['UN', 'OFAC'],
        result: 'clear',
        analyst: 'analyst.b',
      },
    ];

    const report = buildWeeklyCddReport({
      now: NOW,
      customers: [],
      reviewSchedules: [],
      approvals: [],
      filings: [],
      screeningRuns: runs,
    });

    expect(report.sanctionsResolvedThisWeek.map((r) => r.runId)).toEqual([
      'run-1',
    ]);
  });
});

describe('renderWeeklyCddReportMarkdown', () => {
  it('renders headings, rollup, and regulatory citations', () => {
    const report = buildWeeklyCddReport({
      now: NOW,
      customers: [customer('a', 'low'), customer('b', 'high')],
      reviewSchedules: [],
      approvals: [],
      filings: [],
      screeningRuns: [],
    });
    const md = renderWeeklyCddReportMarkdown(report);

    expect(md).toContain('# Weekly CDD Status Report');
    expect(md).toContain('## 1. CDD tier rollup');
    expect(md).toContain('## 2. Reviews overdue or due within 30 days');
    expect(md).toContain(
      '## 3. Pending Senior Management approvals (FDL Art.14, Cabinet Res 134/2025 Art.14)'
    );
    expect(md).toContain('## 4. Filing snapshot');
    expect(md).toContain('## 5. Sanctions matches resolved this week');
    expect(md).toContain('## Regulatory basis');
    expect(md).toContain('FDL No.10/2025 Art.29');
    // Verbose carve-out: the no-tipping-off warning must be present.
    expect(md).toContain('must not be shared with the subject');
  });
});
