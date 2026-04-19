import { describe, it, expect } from 'vitest';
import {
  calibrateIdentityScore,
  observeIdentityEvidence,
  enrichWithBayesianCalibration,
  type EvidenceObservations,
} from '../src/services/identityScoreBayesian';
import type {
  IdentityMatchBreakdown,
  IdentityMatchResult,
} from '../src/services/identityMatchScore';

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

describe('calibrateIdentityScore — posterior behaviour', () => {
  it('returns the prior (0.1) when every LLR is neutral (name in 0.5-0.7 band, nothing observed)', () => {
    // name=0.5 gives 0 LLR per the scorer; other identifiers are
    // unobserved (llr=0). The posterior should collapse back to the prior.
    const cal = calibrateIdentityScore(mkBreakdown({ name: 0.5 }), mkObs());
    expect(cal.probability).toBeGreaterThan(0.09);
    expect(cal.probability).toBeLessThan(0.11);
  });

  it('probability is monotonic with positive name evidence', () => {
    const weak = calibrateIdentityScore(mkBreakdown({ name: 0.5 }), mkObs());
    const mid = calibrateIdentityScore(mkBreakdown({ name: 0.75 }), mkObs());
    const strong = calibrateIdentityScore(mkBreakdown({ name: 0.95 }), mkObs());
    expect(weak.probability).toBeLessThanOrEqual(mid.probability);
    expect(mid.probability).toBeLessThan(strong.probability);
  });

  it('exact-name + DoB-match + ID-match produces a posterior >= 0.99', () => {
    const cal = calibrateIdentityScore(
      mkBreakdown({ name: 1, dob: 1, id: 1, nationality: 1 }),
      mkObs({
        subjectHasDob: true,
        hitHasDob: true,
        subjectHasNationality: true,
        hitHasNationality: true,
        subjectHasId: true,
        hitHasId: true,
      })
    );
    expect(cal.probability).toBeGreaterThan(0.99);
  });

  it('ID contradiction drives the posterior below the prior', () => {
    const cal = calibrateIdentityScore(
      mkBreakdown({ name: 1, id: 0 }),
      mkObs({ subjectHasId: true, hitHasId: true })
    );
    expect(cal.probability).toBeLessThan(0.1);
    expect(cal.contradictions).toContain('id');
  });
});

describe('calibrateIdentityScore — uncertainty interval', () => {
  it('point estimate is always inside [lo, hi]', () => {
    const cal = calibrateIdentityScore(mkBreakdown({ name: 0.8 }), mkObs());
    const [lo, hi] = cal.interval;
    expect(cal.probability).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(cal.probability).toBeLessThanOrEqual(hi + 1e-9);
  });

  it('interval narrows when more identifiers are observed on both sides', () => {
    const sparse = calibrateIdentityScore(mkBreakdown({ name: 0.8 }), mkObs());
    const rich = calibrateIdentityScore(
      mkBreakdown({ name: 0.8, dob: 1, id: 1, nationality: 1 }),
      mkObs({
        subjectHasDob: true,
        hitHasDob: true,
        subjectHasNationality: true,
        hitHasNationality: true,
        subjectHasId: true,
        hitHasId: true,
      })
    );
    const sparseWidth = sparse.interval[1] - sparse.interval[0];
    const richWidth = rich.interval[1] - rich.interval[0];
    expect(richWidth).toBeLessThan(sparseWidth);
  });

  it('flags DoB as unobserved when either side lacks a value', () => {
    const cal = calibrateIdentityScore(
      mkBreakdown({ name: 0.9 }),
      mkObs({ subjectHasDob: true, hitHasDob: false })
    );
    expect(cal.unobserved).toContain('dob');
  });
});

describe('calibrateIdentityScore — counterfactuals', () => {
  it('sorts counterfactuals by logOddsDelta descending', () => {
    const cal = calibrateIdentityScore(
      mkBreakdown({ name: 0.9 }),
      mkObs({ subjectHasDob: false, hitHasDob: true })
    );
    for (let i = 1; i < cal.counterfactuals.length; i++) {
      expect(cal.counterfactuals[i - 1].logOddsDelta).toBeGreaterThanOrEqual(
        cal.counterfactuals[i].logOddsDelta
      );
    }
  });

  it('emits a pin counterfactual when the subject is pinned and hit carries a ref', () => {
    const cal = calibrateIdentityScore(
      mkBreakdown({ name: 0.9, id: 0 }),
      mkObs({ subjectHasPin: true, hitHasRef: true })
    );
    const pinCf = cal.counterfactuals.find((cf) => cf.component === 'pin');
    expect(pinCf).toBeDefined();
    expect(pinCf?.action.toLowerCase()).toContain('pin');
  });

  it('does not emit a DoB counterfactual once DoB is already maxed', () => {
    const cal = calibrateIdentityScore(
      mkBreakdown({ name: 0.9, dob: 1 }),
      mkObs({ subjectHasDob: true, hitHasDob: true })
    );
    expect(cal.counterfactuals.some((cf) => cf.component === 'dob')).toBe(false);
  });
});

describe('observeIdentityEvidence', () => {
  it('reads the flags from the resolved identity + hit shape', () => {
    const obs = observeIdentityEvidence(
      {
        dob: '1970-01-01',
        nationality: 'AE',
        idNumber: 'P12345',
        aliases: ['Abu Test'],
      },
      {
        listEntryDob: '1970-01-01',
        listEntryIdNumber: 'P12345',
      }
    );
    expect(obs.subjectHasDob).toBe(true);
    expect(obs.hitHasDob).toBe(true);
    expect(obs.subjectHasNationality).toBe(true);
    expect(obs.hitHasNationality).toBe(false);
    expect(obs.subjectHasId).toBe(true);
    expect(obs.hitHasId).toBe(true);
    expect(obs.subjectHasAliases).toBe(true);
    expect(obs.subjectHasPin).toBe(false);
    expect(obs.hitHasRef).toBe(false);
  });

  it('handles undefined identity gracefully', () => {
    const obs = observeIdentityEvidence(undefined, {});
    expect(obs.subjectHasDob).toBe(false);
    expect(obs.subjectHasAliases).toBe(false);
  });
});

describe('enrichWithBayesianCalibration', () => {
  it('preserves the existing IdentityMatchResult shape and adds calibrated', () => {
    const base: IdentityMatchResult = {
      composite: 0.6,
      breakdown: mkBreakdown({ name: 0.8, dob: 0 }),
      classification: 'possible',
      hasResolvedIdentity: true,
    };
    const enriched = enrichWithBayesianCalibration(
      base,
      mkObs({ subjectHasDob: true, hitHasDob: true })
    );
    expect(enriched.composite).toBe(0.6);
    expect(enriched.classification).toBe('possible');
    expect(enriched.calibrated.probability).toBeGreaterThan(0);
    expect(enriched.calibrated.probability).toBeLessThan(1);
  });
});
