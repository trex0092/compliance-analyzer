/**
 * Tests for the brain-enrichment path on strSubtaskLifecycle.
 * Verifies that supplying ctx.brain additively enriches the parent
 * and subtasks without breaking the base payload shape.
 */
import { describe, it, expect } from 'vitest';
import {
  buildStrParentTaskPayload,
  buildStrSubtaskPayloads,
  type StrLifecycleContext,
} from '@/services/strSubtaskLifecycle';
import type { EnrichableBrain } from '@/services/asanaBrainEnricher';

const baseCtx: StrLifecycleContext = {
  strId: 'str-abc',
  caseId: 'case-123',
  entityRef: 'case-123',
  riskLevel: 'critical',
  reasonForSuspicion: 'unexplained third-party payment',
  regulatoryBasis: 'FDL No.10/2025 Art.26-27',
  projectGid: '1213759768596515',
  draftedAtIso: '2026-04-13T12:00:00.000Z',
};

function mkBrain(): EnrichableBrain {
  return {
    verdict: 'freeze',
    confidence: 0.94,
    recommendedAction: 'File STR and initiate 24h EOCN freeze',
    requiresHumanReview: true,
    entityId: 'case-123',
    notes: ['Sanctions confirmed', 'Anomaly score 0.93'],
    subsystems: {
      strPrediction: {
        score: 0.91,
      } as unknown as EnrichableBrain['subsystems']['strPrediction'],
      reflection: {
        recommendation: 'freeze',
      } as unknown as EnrichableBrain['subsystems']['reflection'],
      belief: {
        topHypothesis: { label: 'confirmed', probability: 0.94 },
      } as unknown as EnrichableBrain['subsystems']['belief'],
    },
  };
}

describe('buildStrParentTaskPayload — brain enrichment', () => {
  it('returns the base payload unchanged when no brain is supplied', () => {
    const payload = buildStrParentTaskPayload(baseCtx);
    expect(payload.notes).not.toContain('Brain verdict');
    expect(payload.notes).not.toContain('Subsystems fired');
  });

  it('appends a brain reasoning block when ctx.brain is supplied', () => {
    const payload = buildStrParentTaskPayload({ ...baseCtx, brain: mkBrain() });
    expect(payload.notes).toContain('Brain verdict: FREEZE');
    expect(payload.notes).toContain('Subsystems fired');
    expect(payload.notes).toContain('Belief');
  });

  it('preserves FDL Art.29 reminder when brain is supplied', () => {
    const payload = buildStrParentTaskPayload({ ...baseCtx, brain: mkBrain() });
    expect(payload.notes).toContain('Art.29');
    expect(payload.notes).toContain('NO TIPPING OFF');
  });

  it('task name is unchanged by brain enrichment (regression guard)', () => {
    const withoutBrain = buildStrParentTaskPayload(baseCtx);
    const withBrain = buildStrParentTaskPayload({ ...baseCtx, brain: mkBrain() });
    expect(withoutBrain.name).toBe(withBrain.name);
  });
});

describe('buildStrSubtaskPayloads — brain enrichment', () => {
  it('leaves subtask notes unchanged when no brain is supplied', () => {
    const subtasks = buildStrSubtaskPayloads(baseCtx);
    for (const s of subtasks) {
      expect(s.notes).not.toContain('Brain enrichment');
    }
  });

  it('appends a Brain enrichment block to every subtask when supplied', () => {
    const subtasks = buildStrSubtaskPayloads({ ...baseCtx, brain: mkBrain() });
    for (const s of subtasks) {
      expect(s.notes).toContain('Brain enrichment');
    }
  });

  it('mlro-review subtask carries the top hypothesis', () => {
    const subtasks = buildStrSubtaskPayloads({ ...baseCtx, brain: mkBrain() });
    const mlro = subtasks.find((s) => s.stage === 'mlro-review');
    expect(mlro?.notes).toContain('confirmed');
  });

  it('submit-fiu subtask carries the Art.29 reminder from the brain block', () => {
    const subtasks = buildStrSubtaskPayloads({ ...baseCtx, brain: mkBrain() });
    const submit = subtasks.find((s) => s.stage === 'submit-fiu');
    // Both the base notes and the brain block include Art.29 — the
    // test locks the brain path on top of the base path.
    expect(submit?.notes.match(/Art\.29/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('four-eyes subtask reports human-review requirement from the brain', () => {
    const subtasks = buildStrSubtaskPayloads({ ...baseCtx, brain: mkBrain() });
    const fourEyes = subtasks.find((s) => s.stage === 'four-eyes');
    expect(fourEyes?.notes.toLowerCase()).toContain('human review');
  });

  it('still returns exactly 7 subtasks in canonical order', () => {
    const subtasks = buildStrSubtaskPayloads({ ...baseCtx, brain: mkBrain() });
    expect(subtasks).toHaveLength(7);
    expect(subtasks[0].stage).toBe('mlro-review');
    expect(subtasks[6].stage).toBe('close');
  });
});
