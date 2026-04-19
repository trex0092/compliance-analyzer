import { describe, it, expect } from 'vitest';
import { runForensicInvestigation } from '../src/services/forensicInvestigator';
import { evaluateHypotheses } from '../src/services/hypothesisReasoner';
import { calibrateIdentityScore } from '../src/services/identityScoreBayesian';
import type { WatchlistEntry } from '../src/services/screeningWatchlist';
import type { IdentityMatchBreakdown } from '../src/services/identityMatchScore';
import type { EvidenceObservations } from '../src/services/identityScoreBayesian';

function mkSubject(o: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    id: 'C-0001',
    subjectName: 'Mohamed Ahmed',
    riskTier: 'medium',
    addedAtIso: '2026-01-01T00:00:00.000Z',
    seenHitFingerprints: [],
    ...o,
  } as WatchlistEntry;
}

function mkBreakdown(o: Partial<IdentityMatchBreakdown> = {}): IdentityMatchBreakdown {
  return { name: 0, dob: 0, nationality: 0, id: 0, alias: 0, ...o };
}

function mkObs(o: Partial<EvidenceObservations> = {}): EvidenceObservations {
  return {
    subjectHasDob: false,
    hitHasDob: false,
    subjectHasNationality: false,
    hitHasNationality: false,
    subjectHasId: false,
    hitHasId: false,
    subjectHasPin: false,
    hitHasRef: false,
    subjectHasAliases: false,
    ...o,
  };
}

describe('runForensicInvestigation — identity gap findings', () => {
  it('raises concerning finding when DoB is missing on subject', () => {
    const breakdown = mkBreakdown({ name: 0.9 });
    const evidence = mkObs();
    const calibrated = calibrateIdentityScore(breakdown, evidence);
    const hypotheses = evaluateHypotheses(breakdown, evidence);
    const r = runForensicInvestigation({
      subject: mkSubject(),
      breakdown,
      evidence,
      calibrated,
      hypotheses,
    });
    const dobGap = r.findings.find((f) => f.label.includes('DoB'));
    expect(dobGap).toBeDefined();
    expect(dobGap!.category).toBe('identity-gap');
  });

  it('counts identity gaps', () => {
    const breakdown = mkBreakdown({ name: 0.9 });
    const evidence = mkObs();
    const calibrated = calibrateIdentityScore(breakdown, evidence);
    const hypotheses = evaluateHypotheses(breakdown, evidence);
    const r = runForensicInvestigation({
      subject: mkSubject(),
      breakdown,
      evidence,
      calibrated,
      hypotheses,
    });
    expect(r.identityGapCount).toBeGreaterThan(0);
  });
});

describe('runForensicInvestigation — contradictions surface as critical', () => {
  it('dob contradiction becomes a critical finding', () => {
    const breakdown = mkBreakdown({ name: 0.9, dob: 0, nationality: 1 });
    const evidence = mkObs({
      subjectHasDob: true,
      hitHasDob: true,
      subjectHasNationality: true,
      hitHasNationality: true,
    });
    const calibrated = calibrateIdentityScore(breakdown, evidence);
    const hypotheses = evaluateHypotheses(breakdown, evidence);
    const r = runForensicInvestigation({
      subject: mkSubject(),
      breakdown,
      evidence,
      calibrated,
      hypotheses,
    });
    const crit = r.findings.find((f) => f.severity === 'critical');
    expect(crit).toBeDefined();
    expect(r.overallSeverity).toBe('critical');
  });
});

describe('runForensicInvestigation — multi-list finding', () => {
  it('3-list corroboration raises a concerning finding', () => {
    const breakdown = mkBreakdown({ name: 0.9, dob: 1 });
    const evidence = mkObs({ subjectHasDob: true, hitHasDob: true });
    const calibrated = calibrateIdentityScore(breakdown, evidence);
    const hypotheses = evaluateHypotheses(breakdown, evidence);
    const r = runForensicInvestigation({
      subject: mkSubject(),
      breakdown,
      evidence,
      calibrated,
      hypotheses,
      corroboration: {
        lists: ['UN', 'OFAC_SDN', 'EU'],
        dispatchCount: 3,
        boost: 0.5,
      },
    });
    const ml = r.findings.find((f) => f.category === 'multi-list');
    expect(ml).toBeDefined();
    expect(ml!.severity).toBe('concerning');
  });

  it('4-list corroboration raises a critical finding', () => {
    const breakdown = mkBreakdown({ name: 0.9 });
    const evidence = mkObs();
    const calibrated = calibrateIdentityScore(breakdown, evidence);
    const hypotheses = evaluateHypotheses(breakdown, evidence);
    const r = runForensicInvestigation({
      subject: mkSubject(),
      breakdown,
      evidence,
      calibrated,
      hypotheses,
      corroboration: {
        lists: ['UN', 'OFAC_SDN', 'EU', 'UK'],
        dispatchCount: 4,
        boost: 0.7,
      },
    });
    const ml = r.findings.find((f) => f.category === 'multi-list');
    expect(ml!.severity).toBe('critical');
  });
});

describe('runForensicInvestigation — pattern anomalies', () => {
  it('repeat hits → pattern-anomaly finding', () => {
    const breakdown = mkBreakdown({ name: 0.9 });
    const evidence = mkObs();
    const calibrated = calibrateIdentityScore(breakdown, evidence);
    const hypotheses = evaluateHypotheses(breakdown, evidence);
    const r = runForensicInvestigation({
      subject: mkSubject(),
      breakdown,
      evidence,
      calibrated,
      hypotheses,
      recentAlertCount: 4,
    });
    const pa = r.findings.find(
      (f) => f.category === 'pattern-anomaly' && f.label.includes('Repeat')
    );
    expect(pa).toBeDefined();
  });

  it('ID match + name mismatch → identifier-reuse pattern', () => {
    const breakdown = mkBreakdown({ name: 0.2, id: 1 });
    const evidence = mkObs({ subjectHasId: true, hitHasId: true });
    const calibrated = calibrateIdentityScore(breakdown, evidence);
    const hypotheses = evaluateHypotheses(breakdown, evidence);
    const r = runForensicInvestigation({
      subject: mkSubject(),
      breakdown,
      evidence,
      calibrated,
      hypotheses,
    });
    const reuse = r.findings.find((f) => f.label.toLowerCase().includes('identifier reuse'));
    expect(reuse).toBeDefined();
  });
});

describe('runForensicInvestigation — next steps', () => {
  it('next steps sorted by expected probability gain (descending)', () => {
    const breakdown = mkBreakdown({ name: 0.9 });
    const evidence = mkObs();
    const calibrated = calibrateIdentityScore(breakdown, evidence);
    const hypotheses = evaluateHypotheses(breakdown, evidence);
    const r = runForensicInvestigation({
      subject: mkSubject(),
      breakdown,
      evidence,
      calibrated,
      hypotheses,
    });
    expect(r.nextSteps.length).toBeGreaterThan(0);
    for (let i = 1; i < r.nextSteps.length; i += 1) {
      expect(r.nextSteps[i - 1].expectedProbabilityGain).toBeGreaterThanOrEqual(
        r.nextSteps[i].expectedProbabilityGain
      );
    }
  });

  it('escalate-band posterior appends a source-of-funds recommendation', () => {
    const breakdown = mkBreakdown({ name: 1, dob: 1, nationality: 1 });
    const evidence = mkObs({
      subjectHasDob: true,
      hitHasDob: true,
      subjectHasNationality: true,
      hitHasNationality: true,
    });
    const calibrated = calibrateIdentityScore(breakdown, evidence);
    const hypotheses = evaluateHypotheses(breakdown, evidence);
    // Posterior should be >= 0.6 — force it:
    expect(calibrated.probability).toBeGreaterThanOrEqual(0.6);
    const r = runForensicInvestigation({
      subject: mkSubject(),
      breakdown,
      evidence,
      calibrated,
      hypotheses,
    });
    const sof = r.nextSteps.find((s) => s.identifier === 'source-of-funds');
    expect(sof).toBeDefined();
  });
});

describe('runForensicInvestigation — completion detection', () => {
  it('complete evidence set + decisive hypothesis → investigationComplete=true', () => {
    const breakdown = mkBreakdown({ name: 1, dob: 1, id: 1, nationality: 1, alias: 0.1 });
    const evidence = mkObs({
      subjectHasDob: true,
      hitHasDob: true,
      subjectHasId: true,
      hitHasId: true,
      subjectHasNationality: true,
      hitHasNationality: true,
      subjectHasPin: true,
      hitHasRef: true,
      subjectHasAliases: true,
    });
    const calibrated = calibrateIdentityScore(breakdown, evidence);
    const hypotheses = evaluateHypotheses(breakdown, evidence);
    const r = runForensicInvestigation({
      subject: mkSubject({
        resolvedIdentity: {
          dob: '01/01/1970',
          nationality: 'AE',
          idNumber: 'X',
          aliases: ['M.A.'],
          listEntryRef: { list: 'UN', reference: 'QDi.1' },
        } as any,
      }),
      breakdown,
      evidence,
      calibrated,
      hypotheses,
    });
    expect(r.investigationComplete).toBe(true);
    expect(r.verdict).toContain('COMPLETE');
  });
});
