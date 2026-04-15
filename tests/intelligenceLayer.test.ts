/**
 * Intelligence layer tests — meta-brain router + bias auditor +
 * intelligence scorecard.
 */
import { describe, it, expect } from 'vitest';

import {
  routeCase,
  estimateRouterSavings,
  DEFAULT_ROUTING_RULES,
  type CaseSignals,
} from '../src/services/metaBrainRouter';

import {
  auditBias,
  FOUR_FIFTHS_THRESHOLD,
  MIN_SAMPLE_PER_GROUP,
  __test__ as biasInternals,
  type BiasDecisionRecord,
} from '../src/services/biasAuditor';

import {
  buildIntelligenceScorecard,
  buildMaxActiveInputs,
  type IntelligenceInput,
  type SmartInput,
  type AutonomousInput,
} from '../src/services/intelligenceScorecard';

// ===========================================================================
// metaBrainRouter
// ===========================================================================

describe('metaBrainRouter', () => {
  function cleanCase(overrides: Partial<CaseSignals> = {}): CaseSignals {
    return {
      txValue30dAED: 5000,
      nearThresholdCount30d: 0,
      crossBorderRatio30d: 0,
      isPep: false,
      highRiskJurisdiction: false,
      hasAdverseMedia: false,
      sanctionsMatchScore: 0,
      cashRatio30d: 0.2,
      priorAlerts90d: 0,
      ...overrides,
    };
  }

  it('always fires the baseline subsystems on a clean case', () => {
    const r = routeCase(cleanCase());
    expect(r.firingPlan).toContain('megaBrain');
    expect(r.firingPlan).toContain('predictiveStr');
    expect(r.firingPlan).toContain('reasoningChain');
    expect(r.firingPlan).toContain('explainableScoring');
    expect(r.firingPlan).toContain('conformalPrediction');
  });

  it('clean case fires fewer than 40% of subsystems', () => {
    const r = routeCase(cleanCase());
    expect(r.firingRatio).toBeLessThan(0.4);
  });

  it('high-risk case fires many more subsystems', () => {
    const r = routeCase(
      cleanCase({
        txValue30dAED: 250_000,
        sanctionsMatchScore: 0.92,
        isPep: true,
        highRiskJurisdiction: true,
        hasAdverseMedia: true,
        crossBorderRatio30d: 0.8,
        hasTransactionGraph: true,
        hasForeignJurisdiction: true,
      })
    );
    expect(r.firingRatio).toBeGreaterThan(0.6);
    expect(r.firingPlan).toContain('vaspWallets');
    expect(r.firingPlan).toContain('graphRiskScorer');
    expect(r.firingPlan).toContain('multiJurisdictionRuleEngine');
    expect(r.firingPlan).toContain('regulatoryDriftWatchdog');
  });

  it('graph-specific subsystems only fire when a graph is supplied', () => {
    const withGraph = routeCase(cleanCase({ hasTransactionGraph: true }));
    const withoutGraph = routeCase(cleanCase());
    expect(withGraph.firingPlan).toContain('graphRiskScorer');
    expect(withGraph.firingPlan).toContain('transactionGraphEmbedding');
    expect(withoutGraph.firingPlan).not.toContain('graphRiskScorer');
  });

  it('estimateRouterSavings reports non-trivial reduction on a mixed cohort', () => {
    const cases: CaseSignals[] = [
      cleanCase(),
      cleanCase({ txValue30dAED: 50_000 }),
      cleanCase({ sanctionsMatchScore: 0.9, isPep: true }),
      cleanCase({ highRiskJurisdiction: true, hasAdverseMedia: true }),
      cleanCase(),
    ];
    const est = estimateRouterSavings(cases);
    expect(est.avgFiringRatio).toBeLessThan(1);
    expect(est.savedSubsystemInvocations).toBeGreaterThan(0);
  });

  it('DEFAULT_ROUTING_RULES has one rule per subsystem', () => {
    const ids = new Set(DEFAULT_ROUTING_RULES.map((r) => r.subsystem));
    expect(ids.size).toBeGreaterThanOrEqual(20);
  });

  it('every decision carries a regulatory anchor', () => {
    const r = routeCase(cleanCase());
    for (const d of r.decisions) {
      expect(d.regulatory.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// biasAuditor
// ===========================================================================

describe('biasAuditor', () => {
  function makeRecords(
    counts: ReadonlyArray<{ nationality: string; verdicts: Array<'pass' | 'flag' | 'escalate' | 'freeze'> }>
  ): BiasDecisionRecord[] {
    const out: BiasDecisionRecord[] = [];
    let seq = 0;
    for (const group of counts) {
      for (const v of group.verdicts) {
        out.push({
          caseId: `c-${seq++}`,
          verdict: v,
          protectedAttrs: { nationality: group.nationality },
        });
      }
    }
    return out;
  }

  it('clean distribution returns severity=clean', () => {
    const records = makeRecords([
      { nationality: 'AE', verdicts: Array(40).fill('pass') },
      { nationality: 'IN', verdicts: Array(40).fill('pass') },
    ]);
    const r = auditBias(records, ['nationality']);
    expect(r.severity).toBe('clean');
    expect(r.findings.every((f) => !f.fails45Rule)).toBe(true);
  });

  it('detects disparate impact when 4/5 rule fails', () => {
    // AE group: 80% pass, 20% adverse (rate 0.2)
    // IN group: 20% pass, 80% adverse (rate 0.8) -> selection 0.2 / 0.8 = 0.25 < 0.8
    const records = makeRecords([
      {
        nationality: 'AE',
        verdicts: [
          ...Array(32).fill('pass'),
          ...Array(8).fill('flag'),
        ] as Array<'pass' | 'flag' | 'escalate' | 'freeze'>,
      },
      {
        nationality: 'IN',
        verdicts: [
          ...Array(8).fill('pass'),
          ...Array(32).fill('flag'),
        ] as Array<'pass' | 'flag' | 'escalate' | 'freeze'>,
      },
    ]);
    const r = auditBias(records, ['nationality']);
    expect(r.severity).not.toBe('clean');
    const fail = r.findings.find((f) => f.fails45Rule);
    expect(fail).toBeDefined();
    expect(fail!.disadvantagedValue).toBe('IN');
  });

  it('ignores groups below MIN_SAMPLE_PER_GROUP', () => {
    const records = makeRecords([
      {
        nationality: 'AE',
        verdicts: Array(40).fill('pass') as Array<'pass' | 'flag' | 'escalate' | 'freeze'>,
      },
      {
        nationality: 'US',
        verdicts: ['freeze', 'freeze'] as Array<'pass' | 'flag' | 'escalate' | 'freeze'>,
      },
    ]);
    const r = auditBias(records, ['nationality']);
    // US group too small to evaluate — no findings should fire
    expect(r.findings.every((f) => !f.fails45Rule)).toBe(true);
  });

  it('empty records returns clean report', () => {
    const r = auditBias([], ['nationality']);
    expect(r.severity).toBe('clean');
    expect(r.totalRecords).toBe(0);
  });

  it('custom threshold is respected', () => {
    const records = makeRecords([
      {
        nationality: 'AE',
        verdicts: [
          ...Array(35).fill('pass'),
          ...Array(5).fill('flag'),
        ] as Array<'pass' | 'flag' | 'escalate' | 'freeze'>,
      },
      {
        nationality: 'IN',
        verdicts: [
          ...Array(30).fill('pass'),
          ...Array(10).fill('flag'),
        ] as Array<'pass' | 'flag' | 'escalate' | 'freeze'>,
      },
    ]);
    // Default threshold passes this, strict threshold fails
    const defaultR = auditBias(records, ['nationality']);
    expect(defaultR.severity).toBe('clean');
    const strictR = auditBias(records, ['nationality'], { threshold: 0.95 });
    expect(strictR.severity).not.toBe('clean');
  });

  it('twoProportionZ returns 0 on zero samples', () => {
    expect(biasInternals.twoProportionZ(0.5, 0, 0.5, 0)).toBe(0);
  });

  it('adverseRate counts flag+escalate+freeze', () => {
    expect(
      biasInternals.adverseRate({
        pass: 10,
        flag: 1,
        escalate: 2,
        freeze: 7,
        total: 20,
      })
    ).toBeCloseTo(0.5);
  });

  it('carries EU AI Act Art.10 + EEOC citations', () => {
    const r = auditBias([], ['nationality']);
    expect(r.regulatory).toContain('EU AI Act Art.10');
    expect(r.regulatory).toContain('EEOC Uniform Guidelines 1978');
  });

  it('constants are sensible', () => {
    expect(FOUR_FIFTHS_THRESHOLD).toBe(0.8);
    expect(MIN_SAMPLE_PER_GROUP).toBeGreaterThanOrEqual(30);
  });
});

// ===========================================================================
// intelligenceScorecard v2 — normalized to 100 per axis
// ===========================================================================

describe('intelligenceScorecard v2', () => {
  it('fully active inputs report 100/100/100 on every axis', () => {
    const { intelligence, smart, autonomous } = buildMaxActiveInputs();
    const sc = buildIntelligenceScorecard(intelligence, smart, autonomous);
    expect(sc.intelligent).toBe(100);
    expect(sc.smart).toBe(100);
    expect(sc.autonomous).toBe(100);
    expect(sc.composite).toBe(100);
  });

  it('schemaVersion is 2', () => {
    const { intelligence, smart, autonomous } = buildMaxActiveInputs();
    const sc = buildIntelligenceScorecard(intelligence, smart, autonomous);
    expect(sc.schemaVersion).toBe(2);
  });

  it('every axis has exactly 10 layers', () => {
    const { intelligence, smart, autonomous } = buildMaxActiveInputs();
    const sc = buildIntelligenceScorecard(intelligence, smart, autonomous);
    expect(sc.breakdown.intelligent.length).toBe(10);
    expect(sc.breakdown.smart.length).toBe(10);
    expect(sc.breakdown.autonomous.length).toBe(10);
  });

  it('disabling one intelligence layer drops the score by exactly 10', () => {
    const full = buildMaxActiveInputs();
    const scFull = buildIntelligenceScorecard(full.intelligence, full.smart, full.autonomous);
    const one = {
      ...full,
      intelligence: { ...full.intelligence, bayesianInvoked: false },
    };
    const scOne = buildIntelligenceScorecard(one.intelligence, one.smart, one.autonomous);
    expect(scFull.intelligent - scOne.intelligent).toBe(10);
  });

  it('disabling one smart layer drops the score by exactly 10', () => {
    const full = buildMaxActiveInputs();
    const scFull = buildIntelligenceScorecard(full.intelligence, full.smart, full.autonomous);
    const one = { ...full, smart: { ...full.smart, driftChecked: false } };
    const scOne = buildIntelligenceScorecard(one.intelligence, one.smart, one.autonomous);
    expect(scFull.smart - scOne.smart).toBe(10);
  });

  it('disabling one autonomous layer drops the score by exactly 10', () => {
    const full = buildMaxActiveInputs();
    const scFull = buildIntelligenceScorecard(full.intelligence, full.smart, full.autonomous);
    const one = {
      ...full,
      autonomous: { ...full.autonomous, autoDispatched: false },
    };
    const scOne = buildIntelligenceScorecard(one.intelligence, one.smart, one.autonomous);
    expect(scFull.autonomous - scOne.autonomous).toBe(10);
  });

  it('Tier C violation zeroes autonomy even when every other axis is 100', () => {
    const { intelligence, smart, autonomous } = buildMaxActiveInputs();
    const sc = buildIntelligenceScorecard(intelligence, smart, {
      ...autonomous,
      tierCViolations: 1,
    });
    expect(sc.autonomous).toBe(0);
    expect(sc.breakdown.autonomous[0]!.label).toMatch(/Tier C violation/);
    // Other axes still at 100
    expect(sc.intelligent).toBe(100);
    expect(sc.smart).toBe(100);
  });

  it('composite equals arithmetic mean rounded', () => {
    const { intelligence, smart, autonomous } = buildMaxActiveInputs();
    const sc = buildIntelligenceScorecard(intelligence, smart, {
      ...autonomous,
      autoDispatched: false, // autonomy becomes 90
    });
    expect(sc.intelligent).toBe(100);
    expect(sc.smart).toBe(100);
    expect(sc.autonomous).toBe(90);
    expect(sc.composite).toBe(97); // round((100+100+90)/3)
  });

  it('all-false inputs report 0/0/0', () => {
    const allFalse = {
      intelligence: {
        megaBrain: false,
        bayesianInvoked: false,
        causalInvoked: false,
        debateInvoked: false,
        counterfactualInvoked: false,
        advisorInvoked: false,
        graphRiskInvoked: false,
        multiJurisdictionInvoked: false,
        feedbackLoopActive: false,
        metaRouterApplied: false,
      } satisfies IntelligenceInput,
      smart: {
        powerScoreAtLeast70: false,
        conformalBounded: false,
        driftChecked: false,
        reasoningChainNonEmpty: false,
        explainableScoring: false,
        citationsAtLeast5: false,
        fourEyesActive: false,
        tippingOffLinted: false,
        biasAuditCurrent: false,
        scorecardEmitted: false,
      } satisfies SmartInput,
      autonomous: {
        autoDispatched: false,
        autoRemediated: false,
        autoReScreened: false,
        producedByCron: false,
        alertAutoDelivered: false,
        strDraftAutoGenerated: false,
        counterfactualAutoProduced: false,
        evidenceBundleAutoSealed: false,
        metaRouterAutoApplied: false,
        notificationAutoPosted: false,
        tierCViolations: 0,
      } satisfies AutonomousInput,
    };
    const sc = buildIntelligenceScorecard(
      allFalse.intelligence,
      allFalse.smart,
      allFalse.autonomous
    );
    expect(sc.intelligent).toBe(0);
    expect(sc.smart).toBe(0);
    expect(sc.autonomous).toBe(0);
    expect(sc.composite).toBe(0);
  });

  it('carries v2 regulatory anchors', () => {
    const { intelligence, smart, autonomous } = buildMaxActiveInputs();
    const sc = buildIntelligenceScorecard(intelligence, smart, autonomous);
    expect(sc.regulatory).toContain('EU AI Act Art.13');
    expect(sc.regulatory).toContain('NIST AI RMF 1.0 MEASURE-2');
    expect(sc.regulatory).toContain('ISO/IEC 42001');
    expect(sc.regulatory).toContain('FDL No.10/2025 Art.29');
    expect(sc.regulatory).toContain('Cabinet Res 134/2025 Art.12-14');
  });
});
