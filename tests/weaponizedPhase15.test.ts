/**
 * Unit tests for Weaponized Brain Phase 15 subsystems (#110-#114).
 *
 * Covers:
 *   #110 runAdaptiveMeta + recordMlroOutcome (adaptive meta + self-learning)
 *   #111 composeReasoningChain (deep thinking)
 *   #112 calibrateThresholds (self-learning #2, Youden's J)
 *   #113 minePatternClusters (data analysis)
 *   #114 generateHypotheses (reasoning)
 */
import { describe, it, expect } from 'vitest';
import {
  runAdaptiveMeta,
  recordMlroOutcome,
  composeReasoningChain,
  calibrateThresholds,
  minePatternClusters,
  generateHypotheses,
  createInMemoryReliabilityRegistry,
  DEFAULT_RELIABILITY,
  DEFAULT_HYPOTHESES,
  type AgedSignal,
  type LabeledOutcomeSample,
  type PastCaseSignature,
  type MlroOutcome,
} from '@/services/weaponizedPhase15';
import type { SubsystemSignal } from '@/services/contradictionDetector';

// ---------------------------------------------------------------------------
// #110 Adaptive meta-planner
// ---------------------------------------------------------------------------

describe('runAdaptiveMeta (#110)', () => {
  it('returns empty focus when all signals are below the confidence floor', () => {
    const signals: AgedSignal[] = [
      { name: 'sanctionsScreen', impliedVerdict: 'flag', confidence: 0.2 },
      { name: 'uboLayering', impliedVerdict: 'flag', confidence: 0.3 },
    ];
    const out = runAdaptiveMeta({ signals });
    expect(out.topFocus).toEqual([]);
    expect(out.deprioritised).toEqual([]);
    expect(out.dominantSignal).toBeNull();
    expect(out.narrative).toMatch(/no signals cleared/i);
  });

  it('ranks sanctions hits above ESG signals due to regulatory priority', () => {
    const signals: AgedSignal[] = [
      // Priority 1.0 (not in table), very strong confidence
      { name: 'esgAdverseMedia', impliedVerdict: 'flag', confidence: 0.9 },
      // Priority 2.0 for sanctionsScreen
      { name: 'sanctionsScreen', impliedVerdict: 'freeze', confidence: 0.7 },
    ];
    const out = runAdaptiveMeta({ signals });
    expect(out.dominantSignal?.name).toBe('sanctionsScreen');
    expect(out.topFocus[0]?.priority).toBe(2.0);
  });

  it('applies freshness decay to older evidence', () => {
    const fresh: AgedSignal[] = [
      { name: 'uboLayering', impliedVerdict: 'escalate', confidence: 0.8, ageDays: 0 },
    ];
    const stale: AgedSignal[] = [
      { name: 'uboLayering', impliedVerdict: 'escalate', confidence: 0.8, ageDays: 180 },
    ];
    const a = runAdaptiveMeta({ signals: fresh });
    const b = runAdaptiveMeta({ signals: stale });
    expect(a.dominantSignal?.attention).toBeGreaterThan(b.dominantSignal!.attention);
  });

  it('deprioritises signals beyond topK but keeps them in the log', () => {
    const signals: AgedSignal[] = [
      { name: 'sanctionsScreen', impliedVerdict: 'freeze', confidence: 0.9 },
      { name: 'uboLayering', impliedVerdict: 'escalate', confidence: 0.85 },
      { name: 'taintPropagator', impliedVerdict: 'escalate', confidence: 0.8 },
      { name: 'pepProximity', impliedVerdict: 'escalate', confidence: 0.75 },
      { name: 'adverseMediaRanker', impliedVerdict: 'flag', confidence: 0.7 },
      { name: 'transactionAnomaly', impliedVerdict: 'flag', confidence: 0.65 },
      { name: 'crossBorderCash', impliedVerdict: 'flag', confidence: 0.6 },
    ];
    const out = runAdaptiveMeta({ signals, topK: 3 });
    expect(out.topFocus).toHaveLength(3);
    expect(out.deprioritised.length).toBe(signals.length - 3);
    // topFocus sorted descending by attention
    expect(out.topFocus[0]!.attention).toBeGreaterThanOrEqual(out.topFocus[1]!.attention);
    expect(out.topFocus[1]!.attention).toBeGreaterThanOrEqual(out.topFocus[2]!.attention);
  });

  it('uses learned reliability from the registry', () => {
    const registry = createInMemoryReliabilityRegistry([
      {
        name: 'sanctionsScreen',
        reliability: 0.9,
        observationCount: 100,
        lastUpdated: new Date().toISOString(),
      },
      {
        name: 'uboLayering',
        reliability: 0.2,
        observationCount: 100,
        lastUpdated: new Date().toISOString(),
      },
    ]);
    const signals: AgedSignal[] = [
      { name: 'sanctionsScreen', impliedVerdict: 'freeze', confidence: 0.6 },
      { name: 'uboLayering', impliedVerdict: 'escalate', confidence: 0.95 },
    ];
    const out = runAdaptiveMeta({ signals, registry });
    expect(out.dominantSignal?.name).toBe('sanctionsScreen');
  });
});

// ---------------------------------------------------------------------------
// #110 Self-learning — recordMlroOutcome
// ---------------------------------------------------------------------------

describe('recordMlroOutcome (#110 self-learning)', () => {
  it('rewards concurring signals (reliability rises)', () => {
    const registry = createInMemoryReliabilityRegistry();
    const outcome: MlroOutcome = {
      caseId: 'case-1',
      finalVerdict: 'freeze',
      decidedAt: new Date('2026-04-17T00:00:00Z'),
      signals: [
        { name: 'sanctionsScreen', impliedVerdict: 'freeze', confidence: 0.9 },
      ],
    };
    const rec = recordMlroOutcome(registry, outcome);
    expect(rec.updates).toHaveLength(1);
    expect(rec.updates[0]!.direction).toBe(1);
    expect(rec.updates[0]!.updated).toBeGreaterThan(DEFAULT_RELIABILITY);
    expect(registry.get('sanctionsScreen').reliability).toBeGreaterThan(DEFAULT_RELIABILITY);
  });

  it('penalises dissenting signals (reliability falls)', () => {
    const registry = createInMemoryReliabilityRegistry();
    const outcome: MlroOutcome = {
      caseId: 'case-2',
      finalVerdict: 'pass',
      decidedAt: new Date('2026-04-17T00:00:00Z'),
      signals: [
        { name: 'sanctionsScreen', impliedVerdict: 'freeze', confidence: 0.9 },
      ],
    };
    const rec = recordMlroOutcome(registry, outcome);
    expect(rec.updates[0]!.direction).toBe(-1);
    expect(rec.updates[0]!.updated).toBeLessThan(DEFAULT_RELIABILITY);
  });

  it('skips low-confidence signals (no observation, no update)', () => {
    const registry = createInMemoryReliabilityRegistry();
    const outcome: MlroOutcome = {
      caseId: 'case-3',
      finalVerdict: 'flag',
      decidedAt: new Date().toISOString(),
      signals: [
        { name: 'lowSignal', impliedVerdict: 'flag', confidence: 0.3 },
      ],
    };
    const rec = recordMlroOutcome(registry, outcome);
    expect(rec.updates).toHaveLength(0);
  });

  it('clamps reliability into [0.05, 0.95] even under repeated dissent', () => {
    const registry = createInMemoryReliabilityRegistry();
    // Hammer the subsystem with dissent 500 times.
    for (let i = 0; i < 500; i++) {
      recordMlroOutcome(registry, {
        caseId: `c-${i}`,
        finalVerdict: 'pass',
        decidedAt: new Date().toISOString(),
        signals: [{ name: 'alwaysWrong', impliedVerdict: 'freeze', confidence: 0.9 }],
      });
    }
    expect(registry.get('alwaysWrong').reliability).toBeGreaterThanOrEqual(0.05);
    // Same for agreement.
    for (let i = 0; i < 500; i++) {
      recordMlroOutcome(registry, {
        caseId: `d-${i}`,
        finalVerdict: 'freeze',
        decidedAt: new Date().toISOString(),
        signals: [{ name: 'alwaysRight', impliedVerdict: 'freeze', confidence: 0.9 }],
      });
    }
    expect(registry.get('alwaysRight').reliability).toBeLessThanOrEqual(0.95);
  });

  it('records the audit-trail citation (FDL Art.24 + Cabinet Res 134/2025 Art.19)', () => {
    const registry = createInMemoryReliabilityRegistry();
    const rec = recordMlroOutcome(registry, {
      caseId: 'audit-1',
      finalVerdict: 'freeze',
      decidedAt: new Date().toISOString(),
      signals: [
        { name: 's', impliedVerdict: 'freeze', confidence: 0.9 },
      ],
    });
    expect(rec.citation).toMatch(/Art\.24/);
    expect(rec.citation).toMatch(/134\/2025/);
  });
});

// ---------------------------------------------------------------------------
// #111 Reasoning chain composer
// ---------------------------------------------------------------------------

describe('composeReasoningChain (#111)', () => {
  const sampleFocus = [
    {
      name: 'sanctionsScreen',
      impliedVerdict: 'freeze' as const,
      strength: 0.9,
      priority: 2.0,
      reliability: 0.8,
      freshness: 1,
      attention: 1.44,
      citation: 'FDL No.10/2025 Art.35',
    },
    {
      name: 'uboLayering',
      impliedVerdict: 'freeze' as const,
      strength: 0.85,
      priority: 1.6,
      reliability: 0.7,
      freshness: 1,
      attention: 0.9520,
      citation: 'Cabinet Decision 109/2023',
    },
  ];

  it('builds steps ordered by attention', () => {
    const out = composeReasoningChain({
      focus: sampleFocus,
      finalVerdict: 'freeze',
    });
    expect(out.steps[0]!.sourceSubsystem).toBe('sanctionsScreen');
    expect(out.steps).toHaveLength(2);
  });

  it('marks coherent when all steps imply the same verdict', () => {
    const out = composeReasoningChain({ focus: sampleFocus, finalVerdict: 'freeze' });
    expect(out.coherent).toBe(true);
    expect(out.convergedVerdict).toBe('freeze');
  });

  it('marks non-coherent when implied verdicts diverge', () => {
    const mixed = [
      { ...sampleFocus[0]!, impliedVerdict: 'freeze' as const },
      { ...sampleFocus[1]!, impliedVerdict: 'pass' as const },
    ];
    const out = composeReasoningChain({ focus: mixed, finalVerdict: 'freeze' });
    expect(out.coherent).toBe(false);
  });

  it('narrates divergence when chain verdict != MLRO verdict', () => {
    const out = composeReasoningChain({ focus: sampleFocus, finalVerdict: 'flag' });
    expect(out.narrative).toMatch(/divergence/i);
  });

  it('returns empty chain when no focus signals provided', () => {
    const out = composeReasoningChain({ focus: [], finalVerdict: 'pass' });
    expect(out.steps).toHaveLength(0);
    expect(out.chainConfidence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// #112 Threshold self-calibrator
// ---------------------------------------------------------------------------

describe('calibrateThresholds (#112)', () => {
  it('returns no recommendations below MIN_CALIBRATION_SAMPLES per subsystem', () => {
    const samples: LabeledOutcomeSample[] = Array.from({ length: 5 }, (_, i) => ({
      subsystem: 'weak',
      confidence: i / 10,
      correct: i > 2,
    }));
    const out = calibrateThresholds(samples);
    expect(out.recommendations).toHaveLength(0);
    expect(out.narrative).toMatch(/insufficient/i);
  });

  it('learns a high threshold when only high-confidence signals are correct', () => {
    const samples: LabeledOutcomeSample[] = [];
    for (let i = 0; i < 30; i++) {
      samples.push({ subsystem: 'strongOnly', confidence: 0.9, correct: true });
      samples.push({ subsystem: 'strongOnly', confidence: 0.2, correct: false });
    }
    const out = calibrateThresholds(samples);
    expect(out.recommendations).toHaveLength(1);
    expect(out.recommendations[0]!.recommendedThreshold).toBeGreaterThanOrEqual(0.5);
    expect(out.recommendations[0]!.youdenJ).toBeGreaterThan(0.5);
  });

  it('cites Cabinet Res 134/2025 on every recommendation', () => {
    const samples: LabeledOutcomeSample[] = Array.from({ length: 25 }, (_, i) => ({
      subsystem: 'x',
      confidence: (i % 10) / 10,
      correct: i % 2 === 0,
    }));
    const out = calibrateThresholds(samples);
    for (const rec of out.recommendations) {
      expect(rec.citation).toMatch(/134\/2025/);
    }
  });
});

// ---------------------------------------------------------------------------
// #113 Pattern miner
// ---------------------------------------------------------------------------

describe('minePatternClusters (#113)', () => {
  it('clusters cases with similar firing patterns above the Jaccard threshold', () => {
    const cases: PastCaseSignature[] = [
      {
        caseId: 'a',
        finalVerdict: 'escalate',
        firedSubsystems: ['uboLayering', 'sanctionsScreen', 'transactionAnomaly'],
      },
      {
        caseId: 'b',
        finalVerdict: 'escalate',
        firedSubsystems: ['uboLayering', 'sanctionsScreen', 'transactionAnomaly'],
      },
      {
        caseId: 'c',
        finalVerdict: 'escalate',
        firedSubsystems: ['uboLayering', 'sanctionsScreen'],
      },
      {
        caseId: 'lone',
        finalVerdict: 'pass',
        firedSubsystems: ['adverseMediaRanker'],
      },
    ];
    const out = minePatternClusters({ cases, mergeThreshold: 0.6 });
    expect(out.clusters.length).toBeGreaterThanOrEqual(1);
    const firstCluster = out.clusters[0]!;
    expect(firstCluster.memberCaseIds.length).toBeGreaterThanOrEqual(2);
    expect(firstCluster.commonSubsystems).toContain('uboLayering');
    expect(firstCluster.commonSubsystems).toContain('sanctionsScreen');
    expect(out.unclustered).toContain('lone');
  });

  it('returns zero clusters when nothing is similar', () => {
    const cases: PastCaseSignature[] = [
      { caseId: '1', finalVerdict: 'pass', firedSubsystems: ['a'] },
      { caseId: '2', finalVerdict: 'pass', firedSubsystems: ['b'] },
      { caseId: '3', finalVerdict: 'pass', firedSubsystems: ['c'] },
    ];
    const out = minePatternClusters({ cases });
    expect(out.clusters).toHaveLength(0);
    expect(out.unclustered).toHaveLength(3);
  });

  it('computes dominantVerdict agreement fraction', () => {
    const cases: PastCaseSignature[] = [
      { caseId: '1', finalVerdict: 'freeze', firedSubsystems: ['x', 'y', 'z'] },
      { caseId: '2', finalVerdict: 'freeze', firedSubsystems: ['x', 'y', 'z'] },
      { caseId: '3', finalVerdict: 'pass', firedSubsystems: ['x', 'y', 'z'] },
    ];
    const out = minePatternClusters({ cases, mergeThreshold: 0.9 });
    expect(out.clusters).toHaveLength(1);
    expect(out.clusters[0]!.dominantVerdict).toBe('freeze');
    expect(out.clusters[0]!.verdictAgreement).toBeCloseTo(2 / 3, 2);
  });
});

// ---------------------------------------------------------------------------
// #114 Hypothesis generator
// ---------------------------------------------------------------------------

describe('generateHypotheses (#114)', () => {
  it('elevates sanctions_evasion when sanctionsScreen fires strongly', () => {
    const focus = [
      {
        name: 'sanctionsScreen',
        impliedVerdict: 'freeze' as const,
        strength: 0.9,
        priority: 2.0,
        reliability: 0.8,
        freshness: 1,
        attention: 1.44,
        citation: 'FDL Art.35',
      },
    ];
    const out = generateHypotheses({ focus });
    expect(out.mostLikely?.id).toBe('sanctions_evasion');
    expect(out.mostLikely!.posterior).toBeGreaterThan(out.mostLikely!.prior);
  });

  it('elevates layering when UBO subsystems dominate', () => {
    const focus = [
      {
        name: 'uboLayering',
        impliedVerdict: 'escalate' as const,
        strength: 0.9,
        priority: 1.6,
        reliability: 0.8,
        freshness: 1,
        attention: 1.15,
      },
      {
        name: 'ownershipMotifs',
        impliedVerdict: 'escalate' as const,
        strength: 0.85,
        priority: 1.5,
        reliability: 0.7,
        freshness: 1,
        attention: 0.89,
      },
    ];
    const out = generateHypotheses({ focus });
    expect(out.mostLikely?.id).toBe('layering');
    expect(out.mostLikely!.supportingEvidence).toContain('uboLayering');
  });

  it('falls back to legitimate_activity when nothing red-flag fires', () => {
    const out = generateHypotheses({ focus: [] });
    expect(out.mostLikely?.id).toBe('legitimate_activity');
  });

  it('yields probabilities that sum to ~1.0', () => {
    const focus = [
      {
        name: 'pepProximity',
        impliedVerdict: 'escalate' as const,
        strength: 0.8,
        priority: 1.4,
        reliability: 0.7,
        freshness: 1,
        attention: 0.78,
      },
    ];
    const out = generateHypotheses({ focus });
    const total = out.ranked.reduce((a, b) => a + b.posterior, 0);
    expect(total).toBeGreaterThan(0.99);
    expect(total).toBeLessThan(1.01);
  });

  it('every default hypothesis carries a regulatory citation', () => {
    for (const h of DEFAULT_HYPOTHESES) {
      expect(h.citation).toBeTruthy();
      expect(h.citation.length).toBeGreaterThan(5);
    }
  });
});
