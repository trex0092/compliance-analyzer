import { describe, expect, it } from 'vitest';
import { plan, evaluate } from '@/services/mlroOrchestrator';
import type { ComplianceCaseInput, ComplianceDecision } from '@/services/complianceDecisionEngine';
import type { StrFeatures } from '@/services/predictiveStr';

function minimalFeatures(): StrFeatures {
  return {
    priorAlerts90d: 0,
    txValue30dAED: 10_000,
    nearThresholdCount30d: 0,
    crossBorderRatio30d: 0,
    isPep: false,
    highRiskJurisdiction: false,
    hasAdverseMedia: false,
    daysSinceOnboarding: 400,
    sanctionsMatchScore: 0,
    cashRatio30d: 0.1,
  };
}

function minimalCase(): ComplianceCaseInput {
  return {
    tenantId: 'acme',
    topic: 'routine screening',
    entity: {
      id: 'E-001',
      name: 'Clean Corp Ltd',
      features: minimalFeatures(),
      actorUserId: 'mlro-1',
    },
  };
}

function minimalDecision(overrides: Partial<ComplianceDecision> = {}): ComplianceDecision {
  const base: ComplianceDecision = {
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
      verdict: 'pass',
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
  };
  return { ...base, ...overrides };
}

describe('plan()', () => {
  it('always includes MegaBrain + explainable scoring steps', () => {
    const out = plan(minimalCase());
    expect(out.steps.some((s) => s.includes('MegaBrain'))).toBe(true);
    expect(out.steps.some((s) => s.includes('Explainable factor scoring'))).toBe(true);
  });

  it('omits optional steps when the corresponding input is missing', () => {
    const out = plan(minimalCase());
    expect(out.steps.some((s) => s.includes('UBO graph'))).toBe(false);
    expect(out.steps.some((s) => s.includes('VASP wallet'))).toBe(false);
    expect(out.steps.some((s) => s.includes('adverse-media'))).toBe(false);
    expect(out.steps.some((s) => s.includes('transaction anomaly'))).toBe(false);
    expect(out.steps.some((s) => s.includes('four-eyes'))).toBe(false);
  });

  it('includes the zk attestation step unless the caller opts out', () => {
    expect(plan(minimalCase()).steps.some((s) => s.includes('zk-compliance'))).toBe(true);
    const skipSealed = { ...minimalCase(), sealAttestation: false };
    expect(plan(skipSealed).steps.some((s) => s.includes('zk-compliance'))).toBe(false);
  });

  it('adds the filing-step label when a filing is staged', () => {
    const withFiling: ComplianceCaseInput = {
      ...minimalCase(),
      filing: {
        decisionType: 'str_filing',
        approvals: [],
      },
    };
    const out = plan(withFiling);
    expect(out.steps.some((s) => s.includes('four-eyes'))).toBe(true);
  });
});

describe('evaluate()', () => {
  it('raises no concerns on a clean pass decision', () => {
    const decision = minimalDecision();
    const evl = evaluate(decision, minimalCase());
    expect(evl.concerns).toEqual([]);
    expect(evl.shouldConsultAdvisor).toBe(false);
    expect(evl.recommendedVerdict).toBeUndefined();
  });

  it('triggers advisor consultation for a freeze verdict', () => {
    const decision = minimalDecision({ verdict: 'freeze' });
    const evl = evaluate(decision, minimalCase());
    expect(evl.shouldConsultAdvisor).toBe(true);
    expect(evl.concerns.some((c) => c.toLowerCase().includes('freeze'))).toBe(true);
  });

  it('triggers advisor consultation when confidence < 0.7', () => {
    const decision = minimalDecision({ confidence: 0.5 });
    const evl = evaluate(decision, minimalCase());
    expect(evl.shouldConsultAdvisor).toBe(true);
  });

  it('over-rides pass to escalate when STR probability > 0.5', () => {
    const decision = minimalDecision({
      verdict: 'pass',
      strPrediction: {
        probability: 0.8,
        factors: [],
        logit: 1,
        explanation: 'high',
        topRiskFactors: [],
        topProtectiveFactors: [],
      } as unknown as ComplianceDecision['strPrediction'],
    });
    const evl = evaluate(decision, minimalCase());
    expect(evl.recommendedVerdict).toBe('escalate');
  });

  it('flags subsystem failures as advisor triggers', () => {
    const decision = minimalDecision({
      raw: {
        verdict: 'pass',
        confidence: 0.9,
        recommendedAction: 'proceed',
        requiresHumanReview: false,
        extensions: {},
        clampReasons: [],
        subsystemFailures: ['vaspWalletScoring'],
        auditNarrative: 'routine',
      } as unknown as ComplianceDecision['raw'],
    });
    const evl = evaluate(decision, minimalCase());
    expect(evl.shouldConsultAdvisor).toBe(true);
    expect(evl.concerns.some((c) => c.includes('vaspWalletScoring'))).toBe(true);
  });
});
