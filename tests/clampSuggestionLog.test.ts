/**
 * Clamp suggestion log tests.
 */
import { describe, it, expect } from 'vitest';
import {
  buildClampSuggestion,
  ClampSuggestionLog,
  type EvidenceSignal,
} from '../src/services/clampSuggestionLog';

const now = () => new Date('2026-04-14T12:00:00.000Z');

function evidence(overrides: Partial<EvidenceSignal> = {}): EvidenceSignal {
  return {
    truePositive: 0,
    falsePositive: 0,
    falseNegative: 0,
    totalCases: 100,
    ...overrides,
  };
}

describe('buildClampSuggestion', () => {
  const base = {
    clampKey: 'sanctionsMatchMin' as const,
    currentValue: 0.5,
    minValue: 0.1,
    maxValue: 0.9,
    step: 0.05,
    regulatory: 'FDL Art.20',
    now,
  };

  it('returns null when evidence is too thin', () => {
    const s = buildClampSuggestion({
      ...base,
      evidence: evidence({ totalCases: 5 }),
    });
    expect(s).toBeNull();
  });

  it('proposes raise when FP rate high + FN low', () => {
    const s = buildClampSuggestion({
      ...base,
      evidence: evidence({ falsePositive: 40, falseNegative: 2 }),
    });
    expect(s).not.toBeNull();
    expect(s!.proposedValue).toBeGreaterThan(s!.currentValue);
    expect(s!.status).toBe('pending_mlro_review');
  });

  it('proposes reduction when FN rate high + FP low', () => {
    const s = buildClampSuggestion({
      ...base,
      evidence: evidence({ falseNegative: 20, falsePositive: 1 }),
    });
    expect(s).not.toBeNull();
    expect(s!.proposedValue).toBeLessThan(s!.currentValue);
  });

  it('does not propose when FP and FN are balanced', () => {
    const s = buildClampSuggestion({
      ...base,
      evidence: evidence({ falsePositive: 15, falseNegative: 15 }),
    });
    expect(s).toBeNull();
  });

  it('clamps proposal to maxValue', () => {
    const s = buildClampSuggestion({
      ...base,
      currentValue: 0.89,
      evidence: evidence({ falsePositive: 40, falseNegative: 2 }),
    });
    expect(s!.proposedValue).toBeLessThanOrEqual(0.9);
  });
});

describe('ClampSuggestionLog', () => {
  it('appends, reads, and decides', () => {
    const log = new ClampSuggestionLog();
    const s = buildClampSuggestion({
      clampKey: 'debateThreshold',
      currentValue: 0.15,
      minValue: 0.05,
      maxValue: 0.5,
      step: 0.02,
      regulatory: 'FDL Art.20',
      evidence: evidence({ falsePositive: 40 }),
      now,
    })!;
    log.append(s);
    expect(log.size()).toBe(1);
    expect(log.byStatus('pending_mlro_review')).toHaveLength(1);
    expect(log.decide(s.id, 'accepted')).toBe(true);
    expect(log.byStatus('accepted')).toHaveLength(1);
    expect(log.decide('missing', 'rejected')).toBe(false);
  });

  it('all() returns snapshot — mutations do not affect log', () => {
    const log = new ClampSuggestionLog();
    const s = buildClampSuggestion({
      clampKey: 'debateThreshold',
      currentValue: 0.15,
      minValue: 0.05,
      maxValue: 0.5,
      step: 0.02,
      regulatory: 'FDL Art.20',
      evidence: evidence({ falsePositive: 40 }),
      now,
    })!;
    log.append(s);
    const snap = log.all() as typeof log extends { all(): infer R } ? R : never;
    (snap as unknown[]).length = 0;
    expect(log.size()).toBe(1);
  });
});
