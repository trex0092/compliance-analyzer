import { describe, expect, it } from 'vitest';
import { explainDecision } from '@/services/anomalyExplainer';
import type { ComplianceDecision } from '@/services/complianceDecisionEngine';

function decision(overrides: Partial<ComplianceDecision> = {}): ComplianceDecision {
  return {
    id: 'd-1',
    tenantId: 'acme',
    verdict: 'pass',
    confidence: 0.9,
    recommendedAction: 'proceed',
    requiresHumanReview: false,
    strPrediction: {
      probability: 0.05,
      factors: [],
      logit: -3,
      explanation: 'low',
      topRiskFactors: [],
      topProtectiveFactors: [],
    } as unknown as ComplianceDecision['strPrediction'],
    warRoomEvent: {
      id: 'w-1',
      at: new Date().toISOString(),
      kind: 'screening',
      severity: 'info',
      title: 'ok',
    },
    raw: {
      mega: { verdict: 'pass', confidence: 0.9, recommendedAction: 'proceed' },
      verdict: 'pass',
      finalVerdict: 'pass',
      confidence: 0.9,
      recommendedAction: 'proceed',
      requiresHumanReview: false,
      extensions: {},
      clampReasons: [],
      subsystemFailures: [],
      auditNarrative: 'routine',
    } as unknown as ComplianceDecision['raw'],
    at: new Date().toISOString(),
    auditNarrative: 'routine',
    ...overrides,
  };
}

describe('explainDecision', () => {
  it('returns no risk factors for a clean decision with no extensions', () => {
    const r = explainDecision(decision());
    expect(r.topRiskFactors).toEqual([]);
    // The minimal decision still has strProbability=0.05, which is a
    // protective signal (<0.1), so the narrative includes the
    // protective-factors section but no risk-increasing factors.
    expect(r.topProtectiveFactors.length).toBeGreaterThan(0);
    expect(r.narrative).toMatch(/Protective factors/);
  });

  it('flags a sanctions-match contribution when the sanctions extension fired', () => {
    const r = explainDecision(
      decision({
        raw: {
          mega: { verdict: 'pass', confidence: 0.9, recommendedAction: 'proceed' },
          extensions: {
            sanctions: { matchCount: 2, listsChecked: ['OFAC'] },
          },
          clampReasons: [],
          subsystemFailures: [],
          auditNarrative: 'sanctions hit',
        } as unknown as ComplianceDecision['raw'],
      })
    );
    expect(r.topRiskFactors.some((f) => f.factor === 'sanctions-match')).toBe(true);
    expect(r.byGroup.sanctions).toBeGreaterThan(0);
  });

  it('reports sanctioned-ubo when the UBO extension flags a sanctioned beneficial owner', () => {
    const r = explainDecision(
      decision({
        verdict: 'freeze',
        raw: {
          mega: { verdict: 'pass', confidence: 0.9, recommendedAction: 'proceed' },
          extensions: {
            ubo: { summary: { hasSanctionedUbo: true, undisclosedPercentage: 0 } },
          },
          clampReasons: ['sanctioned UBO'],
          subsystemFailures: [],
          auditNarrative: 'ubo freeze',
        } as unknown as ComplianceDecision['raw'],
      })
    );
    expect(r.topRiskFactors.some((f) => f.factor === 'sanctioned-ubo')).toBe(true);
  });

  it('treats >50% STR probability as a behavioural risk factor', () => {
    const r = explainDecision(
      decision({
        strPrediction: {
          probability: 0.8,
          factors: [],
          logit: 1,
          explanation: 'high',
          topRiskFactors: [],
          topProtectiveFactors: [],
        } as unknown as ComplianceDecision['strPrediction'],
      })
    );
    expect(r.topRiskFactors.some((f) => f.factor === 'str-probability-elevated')).toBe(true);
  });

  it('treats <0.1 STR probability as a protective behavioural factor', () => {
    const r = explainDecision(decision());
    expect(r.topProtectiveFactors.some((f) => f.factor === 'str-probability-low')).toBe(true);
  });

  it('records four-eyes approval as a protective governance factor', () => {
    const r = explainDecision(
      decision({
        fourEyes: {
          status: 'approved',
          decisionType: 'str_filing' as never,
          approvers: [] as never,
          missingRoles: [] as never,
          satisfiedAt: new Date().toISOString(),
        } as never,
      })
    );
    expect(r.topProtectiveFactors.some((f) => f.factor === 'four-eyes-approved')).toBe(true);
  });

  it('produces a narrative listing both risk and protective factors', () => {
    const r = explainDecision(
      decision({
        raw: {
          mega: { verdict: 'pass', confidence: 0.9, recommendedAction: 'proceed' },
          extensions: {
            sanctions: { matchCount: 1 },
            adverseMedia: { counts: { critical: 2 } },
          },
          clampReasons: [],
          subsystemFailures: [],
          auditNarrative: 'mixed',
        } as unknown as ComplianceDecision['raw'],
      })
    );
    expect(r.narrative).toMatch(/Risk-increasing factors/);
  });
});
