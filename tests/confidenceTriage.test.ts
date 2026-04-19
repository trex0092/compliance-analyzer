import { describe, it, expect } from 'vitest';
import { triageCalibratedScore } from '../src/services/confidenceTriage';
import type { CalibratedIdentityScore } from '../src/services/identityScoreBayesian';

function mkScore(p: number, width = 0.1): CalibratedIdentityScore {
  const lo = Math.max(0, p - width / 2);
  const hi = Math.min(1, p + width / 2);
  return {
    probability: p,
    logOdds: Math.log(p / (1 - p)),
    interval: [lo, hi],
    counterfactuals: [],
    unobserved: [],
    contradictions: [],
  };
}

describe('triageCalibratedScore — band assignment', () => {
  it('>= 0.85 → freeze', () => {
    const t = triageCalibratedScore(mkScore(0.92));
    expect(t.band).toBe('freeze');
    expect(t.deadlineBusinessHours).toBe(2);
    expect(t.filings).toContain('STR');
    expect(t.filings).toContain('CNMR');
    expect(t.verdict).toContain('FREEZE');
    expect(t.approvers).toContain('MLRO');
    expect(t.approvers).toContain('CO');
  });

  it('0.60-0.85 → escalate', () => {
    const t = triageCalibratedScore(mkScore(0.7));
    expect(t.band).toBe('escalate');
    expect(t.deadlineBusinessHours).toBe(24);
    expect(t.filings.length).toBe(0);
    expect(t.verdict).toContain('ESCALATE');
  });

  it('0.30-0.60 → review', () => {
    const t = triageCalibratedScore(mkScore(0.45));
    expect(t.band).toBe('review');
    expect(t.deadlineBusinessHours).toBe(72);
    expect(t.filings.length).toBe(0);
    expect(t.verdict).toContain('MLRO REVIEW');
  });

  it('0.10-0.30 with wide interval → monitor', () => {
    const t = triageCalibratedScore(mkScore(0.2, 0.4));
    expect(t.band).toBe('monitor');
    expect(t.deadlineBusinessHours).toBeUndefined();
    expect(t.verdict).toContain('MONITOR');
  });

  it('0.10-0.30 with tight interval → dismiss', () => {
    const t = triageCalibratedScore(mkScore(0.2, 0.05));
    expect(t.band).toBe('dismiss-with-evidence');
    expect(t.verdict).toContain('DISMISS');
  });

  it('< 0.10 → dismiss-with-evidence', () => {
    const t = triageCalibratedScore(mkScore(0.05, 0.05));
    expect(t.band).toBe('dismiss-with-evidence');
    expect(t.verdict).toContain('DISMISS');
  });

  it('every band renders at least one action', () => {
    for (const p of [0.95, 0.7, 0.45, 0.2, 0.05]) {
      const t = triageCalibratedScore(mkScore(p, 0.1));
      expect(t.actions.length).toBeGreaterThan(0);
    }
  });

  it('every band warns DO NOT notify the subject on the action list where applicable', () => {
    for (const p of [0.95, 0.7, 0.45]) {
      const t = triageCalibratedScore(mkScore(p));
      const joined = t.actions.join(' ');
      expect(joined).toContain('Art.29');
    }
  });
});
