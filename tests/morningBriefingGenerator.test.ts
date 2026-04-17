/**
 * Weekday Morning Briefing — unit tests.
 *
 * Covers:
 *   - Empty-input renders "No critical items for today".
 *   - Imminent EOCN breaches (< 4h remaining OR breached) surface and
 *     sort by remaining time.
 *   - CNMR breached / due-today pulls a subject into the critical list
 *     even if EOCN is fine.
 *   - Filings due today vs overdue filings bucketing.
 *   - Approvals pending > 48h surface; < 48h filtered out.
 *   - Markdown includes regulatory citations and no-tipping-off warning.
 */

import { describe, it, expect } from 'vitest';
import {
  buildMorningBriefingReport,
  renderMorningBriefingMarkdown,
} from '../src/services/morningBriefingGenerator';
import type {
  FrozenSubjectInput,
  ListHealthStatus,
  RequiredSource,
} from '../src/services/sanctionsWatchGenerator';
import type { ApprovalRequest } from '../src/domain/approvals';
import type { FilingRecord } from '../src/services/screeningComplianceReport';

const NOW = new Date('2026-04-16T04:00:00.000Z'); // 08:00 Dubai (weekday)
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function fullyCovered(): Record<
  RequiredSource,
  { status: ListHealthStatus; lastCheckedAt?: string }
> {
  const stamp = new Date(NOW.getTime() - 2 * HOUR_MS).toISOString();
  return {
    UN: { status: 'ok', lastCheckedAt: stamp },
    OFAC: { status: 'ok', lastCheckedAt: stamp },
    EU: { status: 'ok', lastCheckedAt: stamp },
    UK: { status: 'ok', lastCheckedAt: stamp },
    UAE: { status: 'ok', lastCheckedAt: stamp },
    EOCN: { status: 'ok', lastCheckedAt: stamp },
  };
}

function baseInput() {
  return {
    now: NOW,
    listCoverage: fullyCovered(),
    cronHealth: [],
    reviewsDueToday: [],
    overnightActivity: {
      newConfirmedHits: 0,
      newLikelyHits: 0,
      newPotentialHits: 0,
      deltaScreenRuns: 0,
      sanctionsIngestRuns: 0,
    },
    frozenSubjects: [] as FrozenSubjectInput[],
    pendingApprovals: [] as ApprovalRequest[],
    filings: [] as FilingRecord[],
  };
}

describe('buildMorningBriefingReport — empty inputs', () => {
  it('produces a clean report when nothing is critical', () => {
    const report = buildMorningBriefingReport(baseInput());
    expect(report.criticalToday.imminentFreezeBreaches).toEqual([]);
    expect(report.criticalToday.filingsDueToday).toEqual([]);
    expect(report.criticalToday.reviewsDueToday).toEqual([]);
    expect(report.actionList.pendingApprovalsOver48h).toEqual([]);
    expect(report.actionList.overdueFilings).toEqual([]);
    expect(report.anyListMissing).toBe(false);
  });
});

describe('buildMorningBriefingReport — imminent freeze breaches', () => {
  it('surfaces EOCN < 4h subjects and sorts by remaining time', () => {
    const twentyThreeHoursAgo = new Date(NOW.getTime() - 23 * HOUR_MS).toISOString();
    const twentyHoursAgo = new Date(NOW.getTime() - 20 * HOUR_MS).toISOString();
    const twoHoursAgo = new Date(NOW.getTime() - 2 * HOUR_MS).toISOString();

    const frozen: FrozenSubjectInput[] = [
      {
        subjectId: 'f-fresh',
        subjectName: 'Fresh Freeze',
        matchedSource: 'OFAC',
        matchConfirmedAt: twoHoursAgo,
      },
      {
        subjectId: 'f-1h-left',
        subjectName: '1h Remaining',
        matchedSource: 'UN',
        matchConfirmedAt: twentyThreeHoursAgo,
      },
      {
        subjectId: 'f-4h-left',
        subjectName: '4h Remaining',
        matchedSource: 'EU',
        matchConfirmedAt: twentyHoursAgo,
      },
    ];

    const report = buildMorningBriefingReport({
      ...baseInput(),
      frozenSubjects: frozen,
    });

    const ids = report.criticalToday.imminentFreezeBreaches.map((b) => b.subjectId);
    expect(ids).toContain('f-1h-left');
    expect(ids).toContain('f-4h-left');
    expect(ids).not.toContain('f-fresh');
    expect(ids[0]).toBe('f-1h-left');
  });

  it('includes subjects with CNMR breached even when EOCN is long past', () => {
    // 14 calendar days ago covers 10 business days — definitively past
    // the CNMR 5-BD deadline regardless of where UAE weekends land.
    const fourteenDaysAgo = new Date(NOW.getTime() - 14 * DAY_MS).toISOString();
    const report = buildMorningBriefingReport({
      ...baseInput(),
      frozenSubjects: [
        {
          subjectId: 'f-cnmr',
          subjectName: 'CNMR Breach',
          matchedSource: 'UN',
          matchConfirmedAt: fourteenDaysAgo,
        },
      ],
    });
    const b = report.criticalToday.imminentFreezeBreaches[0];
    expect(b.subjectId).toBe('f-cnmr');
    expect(b.cnmrBreached).toBe(true);
    expect(b.eocnBreached).toBe(true);
  });
});

describe('buildMorningBriefingReport — filings', () => {
  it('buckets pending filings with deadline today as filingsDueToday and flags overdue', () => {
    // CTR has 15 BD deadline. Filed 30 calendar days ago → certainly
    // breached.
    const thirtyDaysAgo = new Date(NOW.getTime() - 30 * DAY_MS).toISOString();

    const filings: FilingRecord[] = [
      {
        filingType: 'CTR',
        filingDate: thirtyDaysAgo,
        referenceNumber: 'CTR-OVERDUE',
        status: 'pending',
        deadlineMet: true,
      },
      {
        filingType: 'DPMSR',
        filingDate: thirtyDaysAgo,
        referenceNumber: 'DPMSR-OVERDUE-SRC',
        status: 'overdue',
        deadlineMet: false,
      },
    ];
    const report = buildMorningBriefingReport({
      ...baseInput(),
      filings,
    });
    const overdueRefs = report.actionList.overdueFilings.map((f) => f.referenceNumber);
    expect(overdueRefs).toContain('CTR-OVERDUE');
    expect(overdueRefs).toContain('DPMSR-OVERDUE-SRC');
  });
});

describe('buildMorningBriefingReport — pending approvals', () => {
  it('surfaces only approvals pending more than 48 hours', () => {
    const fiftyHoursAgo = new Date(NOW.getTime() - 50 * HOUR_MS).toISOString();
    const twentyFourHoursAgo = new Date(NOW.getTime() - 24 * HOUR_MS).toISOString();

    const approvals: ApprovalRequest[] = [
      {
        id: 'ap-old',
        caseId: 'case-old',
        requiredFor: 'edd-continuation',
        status: 'pending',
        requestedBy: 'analyst.a',
        requestedAt: fiftyHoursAgo,
      },
      {
        id: 'ap-new',
        caseId: 'case-new',
        requiredFor: 'pep-onboarding',
        status: 'pending',
        requestedBy: 'analyst.b',
        requestedAt: twentyFourHoursAgo,
      },
      {
        id: 'ap-closed',
        caseId: 'case-closed',
        requiredFor: 'edd-continuation',
        status: 'approved',
        requestedBy: 'analyst.a',
        requestedAt: fiftyHoursAgo,
      },
    ];

    const report = buildMorningBriefingReport({
      ...baseInput(),
      pendingApprovals: approvals,
    });

    expect(report.actionList.pendingApprovalsOver48h.map((p) => p.caseId)).toEqual(['case-old']);
    expect(report.actionList.pendingApprovalsOver48h[0].ageInHours).toBeGreaterThan(48);
  });
});

describe('buildMorningBriefingReport — unwired data sources', () => {
  it('passes through unwiredDataSources verbatim', () => {
    const report = buildMorningBriefingReport({
      ...baseInput(),
      unwiredDataSources: ['frozenSubjects', 'pendingApprovals', 'filings'],
    });
    expect(report.unwiredDataSources).toEqual(['frozenSubjects', 'pendingApprovals', 'filings']);
  });

  it('defaults unwiredDataSources to empty array when not provided', () => {
    const report = buildMorningBriefingReport(baseInput());
    expect(report.unwiredDataSources).toEqual([]);
  });
});

describe('renderMorningBriefingMarkdown', () => {
  it('renders all sections and includes regulatory + no-tipping-off text', () => {
    const report = buildMorningBriefingReport(baseInput());
    const md = renderMorningBriefingMarkdown(report);

    expect(md).toContain('# Compliance Morning Briefing');
    expect(md).toContain('## 1. Critical today');
    expect(md).toContain('## 2. Overnight activity');
    expect(md).toContain('## 3. System health (past 24h)');
    expect(md).toContain('## 4. Action list');
    expect(md).toContain('## 5. List coverage (FDL Art.35, Cabinet Res 74/2020 Art.4)');
    expect(md).toContain('## Regulatory basis');
    expect(md).toContain('FDL No.10/2025 Art.29');
    expect(md).toContain('must not be shared with any subject');
    expect(md).toContain('No critical items for today.');
  });

  it('renders the INCOMPLETE BRIEFING banner when sources are unwired', () => {
    const report = buildMorningBriefingReport({
      ...baseInput(),
      unwiredDataSources: ['frozenSubjects', 'pendingApprovals', 'filings'],
    });
    const md = renderMorningBriefingMarkdown(report);
    expect(md).toContain('⚠ INCOMPLETE BRIEFING');
    expect(md).toContain('frozenSubjects');
    expect(md).toContain('pendingApprovals');
    expect(md).toContain('filings');
  });
});
