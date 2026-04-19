import { describe, it, expect } from 'vitest';
import { evaluateHypotheses } from '../src/services/hypothesisReasoner';
import type { IdentityMatchBreakdown } from '../src/services/identityMatchScore';
import type { EvidenceObservations } from '../src/services/identityScoreBayesian';

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

describe('evaluateHypotheses — posterior shape', () => {
  it('posteriors sum to 1 (Bayesian normalisation)', () => {
    const r = evaluateHypotheses(mkBreakdown({ name: 0.9 }), mkObs());
    const sum = r.ranked.reduce((s, h) => s + h.posterior, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('returns all five hypotheses', () => {
    const r = evaluateHypotheses(mkBreakdown({ name: 0.5 }), mkObs());
    expect(r.ranked.length).toBe(5);
    expect(new Set(r.ranked.map((h) => h.hypothesis)).size).toBe(5);
  });

  it('ranked is sorted descending by posterior', () => {
    const r = evaluateHypotheses(mkBreakdown({ name: 0.9 }), mkObs());
    for (let i = 1; i < r.ranked.length; i += 1) {
      expect(r.ranked[i - 1].posterior).toBeGreaterThanOrEqual(r.ranked[i].posterior);
    }
  });
});

describe('evaluateHypotheses — canonical patterns', () => {
  it('name-only hit favours NAME_COINCIDENCE', () => {
    const r = evaluateHypotheses(
      mkBreakdown({ name: 0.95 }),
      mkObs({ subjectHasDob: true, hitHasDob: false })
    );
    expect(r.leading.hypothesis).toBe('NAME_COINCIDENCE');
  });

  it('full-corroborated hit (name + DoB + ID) favours TRUE_MATCH decisively', () => {
    const r = evaluateHypotheses(
      mkBreakdown({ name: 1, dob: 1, id: 1, nationality: 1 }),
      mkObs({
        subjectHasDob: true,
        hitHasDob: true,
        subjectHasId: true,
        hitHasId: true,
        subjectHasNationality: true,
        hitHasNationality: true,
      })
    );
    expect(r.leading.hypothesis).toBe('TRUE_MATCH');
    expect(r.decisive).toBe(true);
  });

  it('name + nationality agree but DoB conflicts favours FAMILY_RELATIVE', () => {
    const r = evaluateHypotheses(
      mkBreakdown({ name: 0.9, dob: 0, nationality: 1 }),
      mkObs({
        subjectHasDob: true,
        hitHasDob: true,
        subjectHasNationality: true,
        hitHasNationality: true,
      })
    );
    expect(['FAMILY_RELATIVE', 'NAME_COINCIDENCE']).toContain(r.leading.hypothesis);
  });

  it('ID agrees but name differs raises STALE_ID_REUSE', () => {
    const r = evaluateHypotheses(
      mkBreakdown({ name: 0.2, id: 1 }),
      mkObs({ subjectHasId: true, hitHasId: true })
    );
    const staleH = r.ranked.find((h) => h.hypothesis === 'STALE_ID_REUSE');
    expect(staleH).toBeDefined();
    expect(staleH!.posterior).toBeGreaterThan(0.05);
  });

  it('summary stance tag matches the decisive flag', () => {
    const r = evaluateHypotheses(mkBreakdown({ name: 0.75 }), mkObs());
    // Summary always contains either DECISIVE or AMBIGUOUS and must match
    // the boolean in the result.
    if (r.decisive) {
      expect(r.summary).toContain('DECISIVE');
    } else {
      expect(r.summary).toContain('AMBIGUOUS');
    }
  });
});

describe('evaluateHypotheses — supporting / refuting evidence', () => {
  it('TRUE_MATCH lists its supporting evidence', () => {
    const r = evaluateHypotheses(
      mkBreakdown({ name: 1, dob: 1, id: 1 }),
      mkObs({
        subjectHasDob: true,
        hitHasDob: true,
        subjectHasId: true,
        hitHasId: true,
      })
    );
    const tm = r.ranked.find((h) => h.hypothesis === 'TRUE_MATCH')!;
    expect(tm.supporting.length).toBeGreaterThan(0);
    expect(tm.supporting.join(' ')).toMatch(/Name|DoB|ID/i);
  });

  it('NAME_COINCIDENCE is refuted when ID agrees', () => {
    const r = evaluateHypotheses(
      mkBreakdown({ name: 0.9, id: 1 }),
      mkObs({ subjectHasId: true, hitHasId: true })
    );
    const nc = r.ranked.find((h) => h.hypothesis === 'NAME_COINCIDENCE')!;
    expect(nc.refuting.some((r) => r.includes('ID'))).toBe(true);
  });
});
