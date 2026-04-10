import { describe, it, expect } from 'vitest';
import { runMegaBrain, quickMegaAssessment } from '@/services/megaBrain';
import { CaseMemory, type PastCase } from '@/services/caseBasedReasoning';
import type { StrFeatures } from '@/services/predictiveStr';
import { createCausalGraph } from '@/services/causalEngine';
import { STR_FILING_ACTIONS } from '@/services/goalPlanner';

const cleanFeatures: StrFeatures = {
  priorAlerts90d: 0,
  txValue30dAED: 50_000,
  nearThresholdCount30d: 0,
  crossBorderRatio30d: 0,
  isPep: false,
  highRiskJurisdiction: false,
  hasAdverseMedia: false,
  daysSinceOnboarding: 720,
  sanctionsMatchScore: 0,
  cashRatio30d: 0.1,
};

const dangerousFeatures: StrFeatures = {
  priorAlerts90d: 8,
  txValue30dAED: 5_000_000,
  nearThresholdCount30d: 6,
  crossBorderRatio30d: 0.9,
  isPep: true,
  highRiskJurisdiction: true,
  hasAdverseMedia: true,
  daysSinceOnboarding: 20,
  sanctionsMatchScore: 0.92,
  cashRatio30d: 0.8,
};

const mkCase = (id: string, features: Record<string, number>, outcome: PastCase['outcome']): PastCase => ({
  id,
  features,
  outcome,
  confidence: 1,
  summary: id,
  regulatoryRefs: ['FDL Art.19'],
  decidedAtIso: '2026-01-01T00:00:00Z',
});

describe('megaBrain — clean path', () => {
  it('clean customer → pass with high confidence', () => {
    const r = quickMegaAssessment('E1', 'Clean Corp LLC', cleanFeatures);
    expect(r.verdict).toBe('pass');
    expect(r.recommendedAction).toContain('standard monitoring');
    expect(r.chain.sealed).toBe(true);
    expect(r.subsystems.strPrediction.band).toBe('low');
    expect(r.subsystems.reflection).toBeDefined();
  });

  it('war room event is emitted with screening kind', () => {
    const r = quickMegaAssessment('E1', 'Clean Corp LLC', cleanFeatures);
    expect(r.warRoomEvent.kind).toBe('screening');
    expect(r.warRoomEvent.severity).toBe('info');
  });
});

describe('megaBrain — dangerous path', () => {
  it('dangerous customer escalates or freezes', () => {
    const r = quickMegaAssessment('E2', 'Shady Metals Co', dangerousFeatures);
    expect(['escalate', 'freeze']).toContain(r.verdict);
    expect(r.subsystems.strPrediction.band === 'critical' || r.subsystems.strPrediction.band === 'high').toBe(true);
    expect(r.requiresHumanReview).toBe(true);
  });

  it('confirmed sanctions safety-clamp forces freeze', () => {
    const r = runMegaBrain({
      topic: 'Confirmed sanctions match',
      entity: {
        id: 'E3',
        name: 'Sanctioned Trader',
        features: cleanFeatures,
        isSanctionsConfirmed: true,
      },
    });
    expect(r.verdict).toBe('freeze');
    expect(r.notes.join(' ')).toMatch(/SAFETY CLAMP/);
    expect(r.warRoomEvent.kind).toBe('freeze_initiated');
    expect(r.warRoomEvent.severity).toBe('critical');
    expect(r.requiresHumanReview).toBe(true);
  });
});

describe('megaBrain — subsystems wiring', () => {
  it('precedents subsystem fires when memory has similar cases', () => {
    const memory = new CaseMemory();
    memory.retain(mkCase('P1', { sanctionsMatchScore: 0.9, cashRatio30d: 0.8, isPep: 1 }, 'freeze'));
    memory.retain(mkCase('P2', { sanctionsMatchScore: 0.9, cashRatio30d: 0.8, isPep: 1 }, 'freeze'));
    memory.retain(mkCase('P3', { sanctionsMatchScore: 0.9, cashRatio30d: 0.7, isPep: 1 }, 'str-filed'));
    const r = runMegaBrain({
      topic: 'test',
      entity: { id: 'E', name: 'X', features: dangerousFeatures },
      memory,
    });
    expect(r.subsystems.precedents).toBeDefined();
    expect(r.subsystems.precedents!.supportingCases.length).toBeGreaterThan(0);
  });

  it('peer-group anomaly fires when peers provided', () => {
    const peers = [
      { cashRatio30d: 0.1, priorAlerts90d: 0, txValue30dAED: 100_000 },
      { cashRatio30d: 0.12, priorAlerts90d: 0, txValue30dAED: 120_000 },
      { cashRatio30d: 0.1, priorAlerts90d: 1, txValue30dAED: 110_000 },
      { cashRatio30d: 0.11, priorAlerts90d: 0, txValue30dAED: 115_000 },
    ];
    const r = quickMegaAssessment('E', 'Outlier', dangerousFeatures, undefined, peers);
    expect(r.subsystems.anomaly).toBeDefined();
    expect(r.subsystems.anomaly!.anomalies.length).toBeGreaterThan(0);
  });

  it('Bayesian update consumes evidence stream', () => {
    const r = runMegaBrain({
      topic: 'test',
      entity: { id: 'E', name: 'X', features: cleanFeatures },
      evidence: [
        {
          id: 'EV1',
          label: 'adverse media hit',
          likelihood: { clean: 0.1, suspicious: 0.7, confirmed: 0.95 },
        },
      ],
    });
    expect(r.subsystems.belief).toBeDefined();
    expect(r.subsystems.belief!.mostLikely.id).not.toBe('clean');
  });

  it('causal counterfactual runs when graph supplied', () => {
    const graph = createCausalGraph([
      { id: 'screen', equation: { kind: 'constant', value: 0 } },
      { id: 'flag', equation: { kind: 'copy', parent: 'screen' } },
    ]);
    const r = runMegaBrain({
      topic: 'cf',
      entity: { id: 'E', name: 'X', features: cleanFeatures },
      causal: {
        graph,
        observation: { screen: 0 },
        intervention: { screen: 1 },
        target: 'flag',
      },
    });
    expect(r.subsystems.causal).toBeDefined();
    expect(r.subsystems.causal!.change).toBe(true);
  });

  it('planning subsystem returns an action plan', () => {
    const r = runMegaBrain({
      topic: 'plan',
      entity: { id: 'E', name: 'X', features: dangerousFeatures },
      planning: {
        initialState: new Set(),
        goal: ['strFiled'],
        actions: STR_FILING_ACTIONS,
      },
    });
    expect(r.subsystems.plan).toBeDefined();
    expect(r.subsystems.plan!.satisfiedGoal).toBe(true);
    expect(r.subsystems.plan!.steps.length).toBeGreaterThan(0);
  });
});

describe('megaBrain — invariants', () => {
  it('chain always sealed', () => {
    const r = quickMegaAssessment('E', 'X', cleanFeatures);
    expect(r.chain.sealed).toBe(true);
  });

  it('final node always present', () => {
    const r = quickMegaAssessment('E', 'X', cleanFeatures);
    const final = r.chain.nodes.find((n) => n.id === 'final');
    expect(final).toBeDefined();
    expect(final?.type).toBe('decision');
  });

  it('reflection report is always populated', () => {
    const r = quickMegaAssessment('E', 'X', cleanFeatures);
    expect(r.subsystems.reflection.chainId).toBe(r.chain.id);
  });

  it('penalty VaR is always computed', () => {
    const r = quickMegaAssessment('E', 'X', cleanFeatures);
    expect(r.subsystems.penaltyVaR).toBeDefined();
    expect(r.subsystems.penaltyVaR!.valueAtRisk).toBeGreaterThanOrEqual(0);
  });

  it('confidence is the MIN across subsystems', () => {
    const r = quickMegaAssessment('E', 'X', cleanFeatures);
    expect(r.confidence).toBeLessThanOrEqual(r.subsystems.reflection.confidence);
  });
});
