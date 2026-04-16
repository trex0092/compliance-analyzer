/**
 * Sanctions Watch Daily Report — unit tests.
 *
 * Covers:
 *   - All six required sources must appear in coverage, missing ones
 *     trigger a loud ALERT (FDL Art.35, Cabinet Res 74/2020 Art.4).
 *   - Hits are bucketed correctly by DeltaHitConfidence band.
 *   - Confirmed hits land in the confirmed bucket with freeze recommendation.
 *   - Freeze countdowns compute EOCN 24h remaining and CNMR 5BD remaining,
 *     and breached freezes sort ahead of active ones.
 *   - False positives outside the 24h window are excluded.
 *   - Markdown cites regulations and includes the no-tipping-off warning.
 */

import { describe, it, expect } from 'vitest';
import type {
  DeltaScreenHit,
  DeltaHitConfidence,
} from '../src/services/sanctionsDeltaCohortScreener';
import type { SanctionsEntry } from '../src/services/sanctionsDelta';
import {
  buildSanctionsWatchReport,
  renderSanctionsWatchMarkdown,
  REQUIRED_SOURCES,
  type RequiredSource,
  type FrozenSubjectInput,
  type ResolvedFalsePositiveInput,
  type ListHealthStatus,
} from '../src/services/sanctionsWatchGenerator';

const NOW = new Date('2026-04-16T05:00:00.000Z'); // 09:00 Dubai
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function fullyCovered(): Record<
  RequiredSource,
  { status: ListHealthStatus; lastCheckedAt?: string; note?: string }
> {
  const stampIso = new Date(NOW.getTime() - 2 * HOUR_MS).toISOString();
  return {
    UN: { status: 'ok', lastCheckedAt: stampIso },
    OFAC: { status: 'ok', lastCheckedAt: stampIso },
    EU: { status: 'ok', lastCheckedAt: stampIso },
    UK: { status: 'ok', lastCheckedAt: stampIso },
    UAE: { status: 'ok', lastCheckedAt: stampIso },
    EOCN: { status: 'ok', lastCheckedAt: stampIso },
  };
}

function sanctionsEntry(name: string, source: SanctionsEntry['source']): SanctionsEntry {
  return { id: `${source}-${name}`, name, source };
}

function hit(
  customerId: string,
  matchedName: string,
  source: SanctionsEntry['source'],
  confidence: DeltaHitConfidence,
  matchScore: number
): DeltaScreenHit {
  const action: DeltaScreenHit['recommendedAction'] =
    matchScore >= 0.9
      ? 'freeze_immediately'
      : matchScore >= 0.8
        ? 'gate_for_co_review'
        : 'escalate_for_review';
  return {
    customerId,
    tenantId: 'tenant-1',
    matchedAgainst: sanctionsEntry(matchedName, source),
    matchReasons: ['name'],
    matchScore,
    confidence,
    recommendedAction: action,
    regulatory: ['FDL No.10/2025 Art.35'],
  };
}

describe('REQUIRED_SOURCES', () => {
  it('exposes the six UAE TFS sources in the canonical order', () => {
    expect([...REQUIRED_SOURCES]).toEqual(['UN', 'OFAC', 'EU', 'UK', 'UAE', 'EOCN']);
  });
});

describe('buildSanctionsWatchReport — list coverage', () => {
  it('flags missing lists when any of the six required sources is absent', () => {
    const coverage = fullyCovered();
    coverage.EOCN = { status: 'missing' };
    coverage.UK = { status: 'stale', note: 'feed timeout' };

    const report = buildSanctionsWatchReport({
      now: NOW,
      portfolioSize: 42,
      listCoverage: coverage,
      hits: [],
      frozenSubjects: [],
      recentFalsePositives: [],
    });

    expect(report.anyListMissing).toBe(true);
    expect(report.missingSources.sort()).toEqual(['EOCN', 'UK']);
    expect(report.listCoverage).toHaveLength(6);
  });

  it('reports clear coverage when all six sources are ok', () => {
    const report = buildSanctionsWatchReport({
      now: NOW,
      portfolioSize: 42,
      listCoverage: fullyCovered(),
      hits: [],
      frozenSubjects: [],
      recentFalsePositives: [],
    });
    expect(report.anyListMissing).toBe(false);
    expect(report.missingSources).toEqual([]);
  });
});

describe('buildSanctionsWatchReport — hit bucketing', () => {
  it('partitions hits by DeltaHitConfidence band and sorts by score desc', () => {
    const hits: DeltaScreenHit[] = [
      hit('c-1', 'John Smith', 'OFAC', 'confirmed', 0.99),
      hit('c-2', 'John Smyth', 'OFAC', 'likely', 0.85),
      hit('c-3', 'John S', 'OFAC', 'potential', 0.55),
      hit('c-4', 'J Smith', 'OFAC', 'confirmed', 0.95),
      hit('c-5', 'Smithy', 'UN', 'low', 0.45),
    ];

    const report = buildSanctionsWatchReport({
      now: NOW,
      portfolioSize: 100,
      listCoverage: fullyCovered(),
      hits,
      frozenSubjects: [],
      recentFalsePositives: [],
    });

    expect(report.bandCounts).toEqual({
      confirmed: 2,
      likely: 1,
      potential: 1,
      low: 1,
    });
    expect(report.confirmedHits.map((h) => h.customerId)).toEqual(['c-1', 'c-4']);
    expect(report.confirmedHits[0].recommendedAction).toBe('freeze_immediately');
    expect(report.likelyHits[0].recommendedAction).toBe('gate_for_co_review');
    expect(report.potentialHits[0].recommendedAction).toBe('escalate_for_review');
  });
});

describe('buildSanctionsWatchReport — freeze countdowns', () => {
  it('computes EOCN 24h remaining and CNMR 5BD remaining for each frozen subject', () => {
    const twoHoursAgoIso = new Date(NOW.getTime() - 2 * HOUR_MS).toISOString();
    const thirtyHoursAgoIso = new Date(NOW.getTime() - 30 * HOUR_MS).toISOString();

    const frozen: FrozenSubjectInput[] = [
      {
        subjectId: 'freeze-fresh',
        subjectName: 'Acme BV',
        matchedSource: 'OFAC',
        matchConfirmedAt: twoHoursAgoIso,
      },
      {
        subjectId: 'freeze-breached',
        subjectName: 'Stale Co',
        matchedSource: 'UN',
        matchConfirmedAt: thirtyHoursAgoIso,
        eocnNotified: true,
      },
    ];

    const report = buildSanctionsWatchReport({
      now: NOW,
      portfolioSize: 2,
      listCoverage: fullyCovered(),
      hits: [],
      frozenSubjects: frozen,
      recentFalsePositives: [],
    });

    expect(report.freezeCountdowns).toHaveLength(2);
    // Breached EOCN sorts first.
    expect(report.freezeCountdowns[0].subjectId).toBe('freeze-breached');
    expect(report.freezeCountdowns[0].eocnBreached).toBe(true);
    expect(report.freezeCountdowns[0].eocnNotified).toBe(true);

    expect(report.freezeCountdowns[1].subjectId).toBe('freeze-fresh');
    expect(report.freezeCountdowns[1].eocnBreached).toBe(false);
    // ~22 hours remaining, allow rounding.
    expect(report.freezeCountdowns[1].eocnHoursRemaining).toBeGreaterThan(21);
    expect(report.freezeCountdowns[1].eocnHoursRemaining).toBeLessThanOrEqual(22);
    // CNMR has 5 business days budget.
    expect(report.freezeCountdowns[1].cnmrBusinessDaysRemaining).toBeGreaterThan(0);
    expect(report.freezeCountdowns[1].cnmrFiled).toBe(false);
  });
});

describe('buildSanctionsWatchReport — recent false positives', () => {
  it('includes only false positives resolved within the past 24 hours', () => {
    const eightHoursAgoIso = new Date(NOW.getTime() - 8 * HOUR_MS).toISOString();
    const threeDaysAgoIso = new Date(NOW.getTime() - 3 * DAY_MS).toISOString();

    const fps: ResolvedFalsePositiveInput[] = [
      {
        subjectId: 'c-recent',
        matchedAgainst: 'Name Collision Ltd',
        resolvedAt: eightHoursAgoIso,
        resolvedBy: 'analyst.a',
        reason: 'different DOB and nationality',
      },
      {
        subjectId: 'c-old',
        matchedAgainst: 'Other Co',
        resolvedAt: threeDaysAgoIso,
        resolvedBy: 'analyst.a',
        reason: 'out of window',
      },
    ];

    const report = buildSanctionsWatchReport({
      now: NOW,
      portfolioSize: 10,
      listCoverage: fullyCovered(),
      hits: [],
      frozenSubjects: [],
      recentFalsePositives: fps,
    });

    expect(report.recentFalsePositives.map((f) => f.subjectId)).toEqual(['c-recent']);
  });
});

describe('renderSanctionsWatchMarkdown', () => {
  it('renders all sections, cites regulations, and includes no-tipping-off warning', () => {
    const report = buildSanctionsWatchReport({
      now: NOW,
      portfolioSize: 5,
      listCoverage: fullyCovered(),
      hits: [],
      frozenSubjects: [],
      recentFalsePositives: [],
    });
    const md = renderSanctionsWatchMarkdown(report);

    expect(md).toContain('# Sanctions Watch — Daily Report');
    expect(md).toContain('## 1. List coverage (FDL Art.35, Cabinet Res 74/2020 Art.4)');
    expect(md).toContain('## 2. Hits by confidence band');
    expect(md).toContain('## 3. Active freeze countdowns (Cabinet Res 74/2020 Art.4-7)');
    expect(md).toContain('## 4. False positives resolved in the past 24 hours');
    expect(md).toContain('## Regulatory basis');
    expect(md).toContain('All six required sources ingested in the past 24 hours.');
    expect(md).toContain('FDL No.10/2025 Art.29');
    expect(md).toContain('It must not be shared with any subject of a match, freeze, or dismissal');
  });

  it('surfaces the ALERT banner when any required list is missing', () => {
    const coverage = fullyCovered();
    coverage.EOCN = { status: 'missing', note: 'feed unavailable' };

    const report = buildSanctionsWatchReport({
      now: NOW,
      portfolioSize: 5,
      listCoverage: coverage,
      hits: [],
      frozenSubjects: [],
      recentFalsePositives: [],
    });
    const md = renderSanctionsWatchMarkdown(report);

    expect(md).toContain('ALERT: 1 required source(s) missing or stale: EOCN');
    expect(md).toContain(
      'Cabinet Res 74/2020 Art.4 and FATF Rec 6 require every UAE DPMS to screen against all six sources daily.'
    );
  });
});
