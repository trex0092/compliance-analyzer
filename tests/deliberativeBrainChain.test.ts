import { describe, it, expect } from 'vitest';
import { runDeliberativeBrain } from '../src/services/deliberativeBrainChain';
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

const NOW = '2026-04-19T10:00:00.000Z';

describe('runDeliberativeBrain — end-to-end composition', () => {
  it('returns all five output sections', () => {
    const r = runDeliberativeBrain({
      subject: mkSubject(),
      breakdown: mkBreakdown({ name: 0.9 }),
      evidence: mkObs(),
      list: 'UN',
      evidenceObservedAtIso: NOW,
      nowIso: NOW,
    });
    expect(r.prior).toBeDefined();
    expect(r.calibrated).toBeDefined();
    expect(r.hypotheses).toBeDefined();
    expect(r.decay).toBeDefined();
    expect(r.triage).toBeDefined();
    expect(r.trace.length).toBeGreaterThan(0);
  });

  it('uses the dynamic prior from the tier + list classification', () => {
    const highTier = runDeliberativeBrain({
      subject: mkSubject({ riskTier: 'high' }),
      breakdown: mkBreakdown({ name: 0.5 }),
      evidence: mkObs(),
      list: 'UN',
      evidenceObservedAtIso: NOW,
      nowIso: NOW,
    });
    const lowTier = runDeliberativeBrain({
      subject: mkSubject({ riskTier: 'low' }),
      breakdown: mkBreakdown({ name: 0.5 }),
      evidence: mkObs(),
      list: 'UN',
      evidenceObservedAtIso: NOW,
      nowIso: NOW,
    });
    expect(highTier.prior.prior).toBeGreaterThan(lowTier.prior.prior);
    expect(highTier.calibrated.probability).toBeGreaterThan(lowTier.calibrated.probability);
  });

  it('full corroboration + fresh evidence → freeze band', () => {
    const r = runDeliberativeBrain({
      subject: mkSubject({ riskTier: 'high' }),
      breakdown: mkBreakdown({ name: 1, dob: 1, id: 1, nationality: 1 }),
      evidence: mkObs({
        subjectHasDob: true,
        hitHasDob: true,
        subjectHasId: true,
        hitHasId: true,
        subjectHasNationality: true,
        hitHasNationality: true,
      }),
      list: 'OFAC_SDN',
      evidenceObservedAtIso: NOW,
      nowIso: NOW,
    });
    expect(r.triage.band).toBe('freeze');
    expect(r.decay.multiplier).toBeCloseTo(1, 5);
    expect(r.decay.freshness).toBe('fresh');
    expect(r.hypotheses.leading.hypothesis).toBe('TRUE_MATCH');
  });

  it('temporal decay attenuates the log-odds component, not the prior', () => {
    const fresh = runDeliberativeBrain({
      subject: mkSubject(),
      breakdown: mkBreakdown({ name: 0.95 }),
      evidence: mkObs(),
      list: 'UN',
      evidenceObservedAtIso: NOW,
      nowIso: NOW,
    });
    const stale = runDeliberativeBrain({
      subject: mkSubject(),
      breakdown: mkBreakdown({ name: 0.95 }),
      evidence: mkObs(),
      list: 'UN',
      evidenceObservedAtIso: '2024-04-19T10:00:00.000Z', // ~2y old
      nowIso: NOW,
    });
    // Stale evidence should decay toward the prior, not below it.
    expect(stale.decayedProbability).toBeLessThan(fresh.decayedProbability);
    expect(stale.decayedProbability).toBeGreaterThanOrEqual(stale.prior.prior - 0.01);
  });

  it('trace includes every step header', () => {
    const r = runDeliberativeBrain({
      subject: mkSubject(),
      breakdown: mkBreakdown({ name: 0.9 }),
      evidence: mkObs(),
      list: 'UN',
      evidenceObservedAtIso: NOW,
      nowIso: NOW,
    });
    const joined = r.trace.join('\n');
    expect(joined).toContain('STEP 1');
    expect(joined).toContain('STEP 2');
    expect(joined).toContain('STEP 3');
    expect(joined).toContain('STEP 4');
    expect(joined).toContain('STEP 5');
  });

  it('PEP + adverse media push the prior up', () => {
    const base = runDeliberativeBrain({
      subject: mkSubject({ riskTier: 'medium' }),
      breakdown: mkBreakdown({ name: 0.5 }),
      evidence: mkObs(),
      list: 'UN',
      evidenceObservedAtIso: NOW,
      nowIso: NOW,
    });
    const boosted = runDeliberativeBrain({
      subject: mkSubject({ riskTier: 'medium' }),
      breakdown: mkBreakdown({ name: 0.5 }),
      evidence: mkObs(),
      list: 'UN',
      evidenceObservedAtIso: NOW,
      nowIso: NOW,
      isPep: true,
      hasRecentAdverseMedia: true,
    });
    expect(boosted.prior.prior).toBeGreaterThan(base.prior.prior);
  });
});
