import { describe, expect, it } from 'vitest';
import {
  buildFourEyesPlan,
  validateFourEyesCompletion,
} from '@/services/asanaFourEyesAsTasks';

describe('buildFourEyesPlan', () => {
  it('produces a parent + 2 subtasks for STR filing', () => {
    const plan = buildFourEyesPlan({
      decisionId: 'STR-001',
      decisionType: 'str_filing',
      title: 'STR draft saved',
      openedAtIso: '2026-04-13T00:00:00.000Z',
    });
    expect(plan.parent.isParent).toBe(true);
    expect(plan.primary.isParent).toBe(false);
    expect(plan.secondary.isParent).toBe(false);
    expect(plan.primary.parentId).toBe('parent');
    expect(plan.secondary.parentId).toBe('parent');
  });

  it('uses the requested SLA hours when provided', () => {
    const plan = buildFourEyesPlan({
      decisionId: 'D-1',
      decisionType: 'sanctions_freeze',
      title: 'Sanctions freeze',
      openedAtIso: '2026-04-13T00:00:00.000Z',
      slaHours: 6,
    });
    expect(plan.parent.dueAtIso).toBe('2026-04-13T06:00:00.000Z');
  });

  it('defaults to 24h SLA for sanctions_freeze when none supplied', () => {
    const plan = buildFourEyesPlan({
      decisionId: 'D-2',
      decisionType: 'sanctions_freeze',
      title: 'Sanctions freeze',
      openedAtIso: '2026-04-13T00:00:00.000Z',
    });
    expect(plan.parent.dueAtIso).toBe('2026-04-14T00:00:00.000Z');
  });

  it('honours custom primary + secondary roles', () => {
    const plan = buildFourEyesPlan({
      decisionId: 'D-3',
      decisionType: 'edd_escalation',
      title: 'EDD',
      openedAtIso: '2026-04-13T00:00:00.000Z',
      primaryRole: 'co',
      secondaryRole: 'senior_mlro',
    });
    expect(plan.primary.assigneeRole).toBe('co');
    expect(plan.secondary.assigneeRole).toBe('senior_mlro');
  });
});

describe('validateFourEyesCompletion', () => {
  it('rejects when both reviewers are the same user', () => {
    const err = validateFourEyesCompletion({
      primaryUserId: 'mlro-a',
      secondaryUserId: 'mlro-a',
      primaryCompletedAtIso: '2026-04-13T00:00:00.000Z',
      secondaryCompletedAtIso: '2026-04-13T01:00:00.000Z',
    });
    expect(err).toMatch(/cannot complete both/);
  });

  it('rejects when either reviewer is missing', () => {
    const err = validateFourEyesCompletion({
      primaryUserId: '',
      secondaryUserId: 'mlro-b',
      primaryCompletedAtIso: '2026-04-13T00:00:00.000Z',
      secondaryCompletedAtIso: '2026-04-13T01:00:00.000Z',
    });
    expect(err).toMatch(/authenticated/);
  });

  it('rejects when a subtask is incomplete', () => {
    const err = validateFourEyesCompletion({
      primaryUserId: 'mlro-a',
      secondaryUserId: 'mlro-b',
      primaryCompletedAtIso: '2026-04-13T00:00:00.000Z',
    });
    expect(err).toMatch(/marked complete/);
  });

  it('returns null when both reviewers are different and both complete', () => {
    const err = validateFourEyesCompletion({
      primaryUserId: 'mlro-a',
      secondaryUserId: 'mlro-b',
      primaryCompletedAtIso: '2026-04-13T00:00:00.000Z',
      secondaryCompletedAtIso: '2026-04-13T01:00:00.000Z',
    });
    expect(err).toBeNull();
  });
});
