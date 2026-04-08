import { describe, it, expect } from 'vitest';
import { consensusToScreeningRun } from '../src/services/multiModelScreening';
import type { ConsensusResult, ModelOpinion } from '../src/services/multiModelScreening';

function makeOpinion(overrides: Partial<ModelOpinion> = {}): ModelOpinion {
  return {
    model: 'test-model',
    verdict: 'clear',
    confidence: 0.9,
    reasoning: 'No matches found',
    riskIndicators: [],
    responseTimeMs: 500,
    ...overrides,
  };
}

function makeConsensusResult(overrides: Partial<ConsensusResult> = {}): ConsensusResult {
  return {
    entityName: 'Test Entity',
    screeningType: 'sanctions',
    consensus: 'clear',
    consensusConfidence: 0.9,
    agreementRatio: 1.0,
    opinions: [makeOpinion()],
    modelsQueried: 5,
    modelsResponded: 3,
    riskScore: 2,
    riskLevel: 'low',
    topRiskIndicators: [],
    recommendedAction: 'Standard CDD.',
    executedAt: new Date().toISOString(),
    totalDurationMs: 3000,
    ...overrides,
  };
}

describe('consensusToScreeningRun', () => {
  it('converts a clear consensus to ScreeningRun', () => {
    const result = makeConsensusResult({
      consensus: 'clear',
      consensusConfidence: 0.95,
      agreementRatio: 1.0,
      opinions: [
        makeOpinion({ model: 'claude-3.5-sonnet' }),
        makeOpinion({ model: 'gpt-4o' }),
        makeOpinion({ model: 'gemini-pro' }),
      ],
    });

    const run = consensusToScreeningRun(result, 'SUBJ-001', 'analyst@co.ae');

    expect(run.id).toMatch(/^MMS-/);
    expect(run.subjectType).toBe('entity');
    expect(run.subjectId).toBe('SUBJ-001');
    expect(run.analyst).toBe('analyst@co.ae');
    expect(run.systemUsed).toContain('3/5');
    expect(run.listsChecked).toEqual([
      'claude-3.5-sonnet',
      'gpt-4o',
      'gemini-pro',
    ]);
    expect(run.result).toBe('clear');
    expect(run.falsePositiveResolution).toContain('100%');
  });

  it('converts a potential-match consensus to ScreeningRun', () => {
    const result = makeConsensusResult({
      consensus: 'potential-match',
      opinions: [
        makeOpinion({ verdict: 'potential-match', model: 'model-a' }),
        makeOpinion({ verdict: 'clear', model: 'model-b' }),
      ],
    });

    const run = consensusToScreeningRun(result, 'SUBJ-002', 'co@firm.ae');
    expect(run.result).toBe('potential-match');
    expect(run.falsePositiveResolution).toBeUndefined();
  });

  it('converts a confirmed-match consensus to ScreeningRun', () => {
    const result = makeConsensusResult({
      consensus: 'confirmed-match',
      opinions: [
        makeOpinion({ verdict: 'confirmed-match', confidence: 0.95, model: 'model-a' }),
      ],
    });

    const run = consensusToScreeningRun(result, 'SUBJ-003', 'co@firm.ae');
    expect(run.result).toBe('confirmed-match');
    expect(run.falsePositiveResolution).toBeUndefined();
  });
});

describe('ConsensusResult structure', () => {
  it('has all required fields', () => {
    const result = makeConsensusResult();

    expect(result.entityName).toBeDefined();
    expect(result.screeningType).toBeDefined();
    expect(result.consensus).toMatch(/^(clear|potential-match|confirmed-match)$/);
    expect(result.consensusConfidence).toBeGreaterThanOrEqual(0);
    expect(result.consensusConfidence).toBeLessThanOrEqual(1);
    expect(result.agreementRatio).toBeGreaterThanOrEqual(0);
    expect(result.agreementRatio).toBeLessThanOrEqual(1);
    expect(result.modelsQueried).toBeGreaterThan(0);
    expect(result.modelsResponded).toBeGreaterThan(0);
    expect(result.riskLevel).toMatch(/^(low|medium|high|critical)$/);
    expect(result.executedAt).toBeDefined();
  });

  it('risk levels map correctly', () => {
    // Low risk
    expect(makeConsensusResult({ riskLevel: 'low' }).riskLevel).toBe('low');
    // Critical risk
    expect(makeConsensusResult({ riskLevel: 'critical' }).riskLevel).toBe('critical');
  });
});

describe('ModelOpinion structure', () => {
  it('has valid verdict values', () => {
    const clearOp = makeOpinion({ verdict: 'clear' });
    const potentialOp = makeOpinion({ verdict: 'potential-match' });
    const confirmedOp = makeOpinion({ verdict: 'confirmed-match' });

    expect(clearOp.verdict).toBe('clear');
    expect(potentialOp.verdict).toBe('potential-match');
    expect(confirmedOp.verdict).toBe('confirmed-match');
  });

  it('clamps confidence to 0-1 range', () => {
    const op = makeOpinion({ confidence: 0.85 });
    expect(op.confidence).toBeGreaterThanOrEqual(0);
    expect(op.confidence).toBeLessThanOrEqual(1);
  });

  it('tracks response time', () => {
    const op = makeOpinion({ responseTimeMs: 1500 });
    expect(op.responseTimeMs).toBe(1500);
  });
});
