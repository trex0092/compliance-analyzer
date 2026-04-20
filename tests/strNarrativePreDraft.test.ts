import { describe, it, expect } from 'vitest';
import { buildStrNarrativeDraft } from '../src/services/strNarrativePreDraft';
import type { WatchlistEntry } from '../src/services/screeningWatchlist';
import type { RiskAlertMatch, RiskAlertScore } from '../src/services/riskAlertTemplate';
import type { CalibratedIdentityScore } from '../src/services/identityScoreBayesian';
import type { SubjectCorroboration } from '../src/services/multiListCorroboration';

const SUBJECT: WatchlistEntry = {
  id: 'CUS-42',
  subjectName: 'Jane Doe',
  riskTier: 'high',
  addedAtIso: '2026-03-01T00:00:00.000Z',
  seenHitFingerprints: [],
  alertCount: 0,
  resolvedIdentity: {
    dob: '1970-01-01',
    nationality: 'AE',
    idNumber: 'P12345',
    idType: 'passport',
    aliases: ['J.D.'],
    resolvedAtIso: '2026-04-01T12:00:00.000Z',
    listEntryRef: { list: 'UN', reference: 'QDi.123' },
  },
};

const MATCH: RiskAlertMatch = {
  list: 'UN',
  reference: 'QDi.123',
  entryName: 'JANE DOE',
  entryDob: '1970-01-01',
  entryNationality: 'AE',
  entryId: 'P12345',
  listedOn: '2020-05-05',
  reason: 'Designated under UNSC Res 1267',
  changeType: 'NEW',
};

const SCORE: RiskAlertScore = {
  composite: 0.95,
  classification: 'alert',
  breakdown: { name: 1, dob: 1, nationality: 1, id: 1, alias: 0 },
  clamped: false,
};

const CALIBRATED: CalibratedIdentityScore = {
  probability: 0.97,
  logOdds: 3.4,
  interval: [0.9, 0.99],
  counterfactuals: [],
  unobserved: [],
  contradictions: [],
};

const CORRO: SubjectCorroboration = {
  lists: ['UN', 'OFAC_SDN', 'EU'],
  dispatchCount: 3,
  boost: 0.5,
};

describe('buildStrNarrativeDraft', () => {
  it('produces a deterministic paragraph for the same inputs', () => {
    const a = buildStrNarrativeDraft({
      subject: SUBJECT,
      match: MATCH,
      score: SCORE,
      calibrated: CALIBRATED,
      corroboration: CORRO,
      generatedAtIso: '2026-04-19T09:00:00.000Z',
      runId: 'run-1',
    });
    const b = buildStrNarrativeDraft({
      subject: SUBJECT,
      match: MATCH,
      score: SCORE,
      calibrated: CALIBRATED,
      corroboration: CORRO,
      generatedAtIso: '2026-04-19T09:00:00.000Z',
      runId: 'run-1',
    });
    expect(a.paragraph).toBe(b.paragraph);
    expect(a.factList).toEqual(b.factList);
  });

  it('cites the FIU filing deadlines (STR file without delay per FDL Art.26-27, 5 business days CNMR)', () => {
    const d = buildStrNarrativeDraft({
      subject: SUBJECT,
      match: MATCH,
      score: SCORE,
      calibrated: CALIBRATED,
      corroboration: CORRO,
      generatedAtIso: '2026-04-19T09:00:00.000Z',
      runId: 'run-1',
    });
    // STR = 0: FDL Art.26-27 "without delay" — not a grace period. Aligned
    // with src/domain/constants.ts (the single source of truth); the
    // prior 10-business-day drift lived only in two call sites and is
    // retired in the same commit as this test update.
    expect(d.filingDeadline.strBusinessDays).toBe(0);
    expect(d.filingDeadline.cnmrBusinessDays).toBe(5);
  });

  it('renders the no-tipping-off citation (FDL Art.29)', () => {
    const d = buildStrNarrativeDraft({
      subject: SUBJECT,
      match: MATCH,
      score: SCORE,
      calibrated: CALIBRATED,
      corroboration: CORRO,
      generatedAtIso: '2026-04-19T09:00:00.000Z',
      runId: 'run-1',
    });
    expect(d.paragraph).toContain('Art.29');
    expect(d.paragraph.toLowerCase()).toContain('no tipping off');
  });

  it('uses pinned fragment when the subject is pinned', () => {
    const d = buildStrNarrativeDraft({
      subject: SUBJECT,
      match: MATCH,
      score: SCORE,
      calibrated: CALIBRATED,
      corroboration: CORRO,
      generatedAtIso: '2026-04-19T09:00:00.000Z',
      runId: 'run-1',
    });
    expect(d.paragraph).toContain('previously pinned');
    expect(d.paragraph).toContain('UN/QDi.123');
  });

  it('uses unresolved fragment when the subject has no pin', () => {
    const unpinned: WatchlistEntry = {
      ...SUBJECT,
      resolvedIdentity: { ...SUBJECT.resolvedIdentity!, listEntryRef: undefined },
    };
    const d = buildStrNarrativeDraft({
      subject: unpinned,
      match: MATCH,
      score: SCORE,
      calibrated: CALIBRATED,
      corroboration: CORRO,
      generatedAtIso: '2026-04-19T09:00:00.000Z',
      runId: 'run-1',
    });
    expect(d.paragraph).toContain('not been pinned');
  });

  it('includes contradictions in the fact list when present', () => {
    const cal: CalibratedIdentityScore = {
      ...CALIBRATED,
      contradictions: ['dob', 'id'],
    };
    const d = buildStrNarrativeDraft({
      subject: SUBJECT,
      match: MATCH,
      score: SCORE,
      calibrated: cal,
      corroboration: CORRO,
      generatedAtIso: '2026-04-19T09:00:00.000Z',
      runId: 'run-1',
    });
    expect(d.paragraph).toContain('did not agree');
    expect(d.factList.some((f) => f.toLowerCase().includes('contradictions'))).toBe(true);
  });

  it('mentions multi-list corroboration when 2+ lists have flagged the subject', () => {
    const d = buildStrNarrativeDraft({
      subject: SUBJECT,
      match: MATCH,
      score: SCORE,
      calibrated: CALIBRATED,
      corroboration: CORRO,
      generatedAtIso: '2026-04-19T09:00:00.000Z',
      runId: 'run-1',
    });
    expect(d.paragraph).toContain('3 sanctions lists');
  });

  it('includes the calibrated posterior probability in the paragraph', () => {
    const d = buildStrNarrativeDraft({
      subject: SUBJECT,
      match: MATCH,
      score: SCORE,
      calibrated: CALIBRATED,
      corroboration: CORRO,
      generatedAtIso: '2026-04-19T09:00:00.000Z',
      runId: 'run-1',
    });
    expect(d.paragraph).toContain('97.0%');
  });
});
