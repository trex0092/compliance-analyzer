import { describe, it, expect } from 'vitest';
import { CaseMemory } from '@/services/caseBasedReasoning';
import {
  applyOverride,
  applyOverrideBatch,
  initialFeedbackState,
  type Override,
} from '@/services/feedbackLearner';

const escalateOverride: Override = {
  caseId: 'CASE-1',
  mlroName: 'Sarah Al-Mansouri',
  decidedAtIso: '2026-04-01T00:00:00Z',
  features: { sanctionsHit: 0.8, cash: 0.9, pep: 1 },
  brainVerdict: 'flag',
  humanVerdict: 'freeze',
  humanOutcome: 'freeze',
  rationale: 'Sanctions hit above soft threshold + PEP association',
};

const downgradeOverride: Override = {
  caseId: 'CASE-2',
  mlroName: 'Sarah Al-Mansouri',
  decidedAtIso: '2026-04-02T00:00:00Z',
  features: { sanctionsHit: 0.1, cash: 0.1, pep: 0 },
  brainVerdict: 'escalate',
  humanVerdict: 'pass',
  humanOutcome: 'monitor',
  rationale: 'False positive — CDD confirmed legitimate',
};

describe('feedbackLearner — case retention', () => {
  it('retains an escalation override as a past case', () => {
    const memory = new CaseMemory();
    const state = initialFeedbackState();
    applyOverride(memory, state, escalateOverride);
    expect(memory.size()).toBe(1);
    expect(memory.snapshot()[0].outcome).toBe('freeze');
    expect(memory.snapshot()[0].confidence).toBeGreaterThan(0.5);
  });

  it('retains a downgrade override too', () => {
    const memory = new CaseMemory();
    const state = initialFeedbackState();
    applyOverride(memory, state, downgradeOverride);
    expect(memory.size()).toBe(1);
    expect(memory.snapshot()[0].outcome).toBe('monitor');
  });
});

describe('feedbackLearner — weight learning', () => {
  it('escalation override bumps top feature weights', () => {
    const memory = new CaseMemory();
    const state = initialFeedbackState({ sanctionsHit: 1, cash: 1, pep: 1 });
    const updated = applyOverride(memory, state, escalateOverride);
    expect(updated.overridesApplied).toBe(1);
    expect(updated.changes.length).toBeGreaterThan(0);
    expect(updated.weights.pep).toBeGreaterThan(1);
  });

  it('downgrade override does NOT change weights', () => {
    const memory = new CaseMemory();
    const state = initialFeedbackState({ sanctionsHit: 1, cash: 1, pep: 1 });
    const updated = applyOverride(memory, state, downgradeOverride);
    expect(updated.changes).toHaveLength(0);
    expect(updated.weights).toEqual(state.weights);
  });

  it('weights are clamped to MAX_WEIGHT', () => {
    const memory = new CaseMemory();
    let state = initialFeedbackState({ pep: 9.5 });
    for (let i = 0; i < 20; i++) {
      state = applyOverride(memory, state, { ...escalateOverride, caseId: `CASE-${i}` });
    }
    expect(state.weights.pep).toBeLessThanOrEqual(10);
  });
});

describe('feedbackLearner — batch application', () => {
  it('applies multiple overrides sequentially', () => {
    const memory = new CaseMemory();
    const state = initialFeedbackState();
    const overrides: Override[] = [
      { ...escalateOverride, caseId: 'C1' },
      { ...escalateOverride, caseId: 'C2' },
      { ...downgradeOverride, caseId: 'C3' },
    ];
    const updated = applyOverrideBatch(memory, state, overrides);
    expect(updated.overridesApplied).toBe(3);
    expect(memory.size()).toBe(3);
  });
});
