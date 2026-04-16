/**
 * Tests for asanaBrainStateReconciler.ts — pure compute.
 */
import { describe, it, expect } from 'vitest';
import {
  reconcileTenant,
  type AsanaTaskSnapshot,
  type BrainCase,
} from '@/services/asanaBrainStateReconciler';

const NOW = 1_750_000_000_000;
const TENANT = 'madison-llc';

function brain(partial: Partial<BrainCase>): BrainCase {
  return {
    caseId: 'C-001',
    tenantId: TENANT,
    state: 'awaiting_four_eyes',
    updatedAtMs: NOW - 30 * 60 * 1000,
    asanaTaskGid: 'T-001',
    ...partial,
  };
}

function task(partial: Partial<AsanaTaskSnapshot>): AsanaTaskSnapshot {
  return {
    taskGid: 'T-001',
    caseId: 'C-001',
    tenantId: TENANT,
    state: 'open',
    updatedAtMs: NOW - 30 * 60 * 1000,
    ...partial,
  };
}

describe('reconcileTenant — agreement', () => {
  it('completed-completed reports inAgreement, no actions', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'completed' })],
      [task({ state: 'completed' })],
      { nowMs: NOW }
    );
    expect(result.actions).toEqual([]);
    expect(result.inAgreement).toEqual(['C-001']);
  });

  it('awaiting_four_eyes-open reports inAgreement', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'awaiting_four_eyes' })],
      [task({ state: 'open' })],
      { nowMs: NOW }
    );
    expect(result.inAgreement).toEqual(['C-001']);
  });

  it('pending-in_progress reports inAgreement', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'pending' })],
      [task({ state: 'in_progress' })],
      { nowMs: NOW }
    );
    expect(result.inAgreement).toEqual(['C-001']);
  });
});

describe('reconcileTenant — class 1 (Asana ahead, advance brain)', () => {
  it('emits advance_brain_to_completed when Asana done and brain pending', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'awaiting_four_eyes' })],
      [task({ state: 'completed' })],
      { nowMs: NOW }
    );
    expect(result.actions.length).toBe(1);
    expect(result.actions[0].kind).toBe('advance_brain_to_completed');
    expect(result.actions[0].caseId).toBe('C-001');
    expect(result.actions[0].narrative).toContain('FDL Art.20');
  });

  it('emits advance_brain_to_rejected when Asana rejected and brain pending', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'awaiting_four_eyes' })],
      [task({ state: 'rejected' })],
      { nowMs: NOW }
    );
    expect(result.actions[0].kind).toBe('advance_brain_to_rejected');
  });
});

describe('reconcileTenant — class 2 (brain ahead, never auto-rollback)', () => {
  it('flags rather than rolls back when brain completed and Asana still open', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'completed' })],
      [task({ state: 'open' })],
      { nowMs: NOW }
    );
    expect(result.actions[0].kind).toBe('flag_for_mlro_brain_ahead_of_asana');
    expect(result.actions[0].narrative).toContain('load-bearing');
  });

  it('flags when brain rejected and Asana in_progress', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'rejected' })],
      [task({ state: 'in_progress' })],
      { nowMs: NOW }
    );
    expect(result.actions[0].kind).toBe('flag_for_mlro_brain_ahead_of_asana');
  });
});

describe('reconcileTenant — class 3 (missing task)', () => {
  it('flags when brain has case but Asana has no matching task', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'awaiting_four_eyes' })],
      [], // no tasks
      { nowMs: NOW }
    );
    expect(result.actions[0].kind).toBe('flag_for_mlro_task_missing');
    expect(result.actions[0].narrative).toContain('dispatch was skipped');
  });

  it('flags when Asana reports task state as missing', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'awaiting_four_eyes' })],
      [task({ state: 'missing' })],
      { nowMs: NOW }
    );
    expect(result.actions[0].kind).toBe('flag_for_mlro_task_missing');
  });
});

describe('reconcileTenant — tolerance window', () => {
  it('tolerates drift younger than the tolerance window', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'awaiting_four_eyes', updatedAtMs: NOW - 2_000 })],
      [task({ state: 'completed', updatedAtMs: NOW - 2_000 })],
      { nowMs: NOW } // default 10 min tolerance
    );
    expect(result.tolerated).toEqual(['C-001']);
    expect(result.actions).toEqual([]);
  });

  it('acts on drift older than the tolerance window', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'awaiting_four_eyes', updatedAtMs: NOW - 30 * 60 * 1000 })],
      [task({ state: 'completed', updatedAtMs: NOW - 30 * 60 * 1000 })],
      { nowMs: NOW }
    );
    expect(result.actions.length).toBe(1);
    expect(result.actions[0].kind).toBe('advance_brain_to_completed');
  });

  it('respects custom tolerance override', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'awaiting_four_eyes', updatedAtMs: NOW - 30_000 })],
      [task({ state: 'completed', updatedAtMs: NOW - 30_000 })],
      { nowMs: NOW, toleranceMs: 10_000 } // strict 10s
    );
    expect(result.actions[0].kind).toBe('advance_brain_to_completed');
  });

  it('tolerates a missing-task drift while still fresh', () => {
    const result = reconcileTenant(
      TENANT,
      [brain({ state: 'awaiting_four_eyes', updatedAtMs: NOW - 1_000 })],
      [],
      { nowMs: NOW }
    );
    expect(result.tolerated).toEqual(['C-001']);
    expect(result.actions).toEqual([]);
  });
});

describe('reconcileTenant — tenant isolation', () => {
  it('ignores cases belonging to a different tenant', () => {
    const result = reconcileTenant(
      TENANT,
      [
        brain({ caseId: 'C-001', tenantId: TENANT, state: 'awaiting_four_eyes' }),
        brain({ caseId: 'C-002', tenantId: 'other-tenant', state: 'awaiting_four_eyes' }),
      ],
      [
        task({ taskGid: 'T-001', caseId: 'C-001', tenantId: TENANT, state: 'completed' }),
        task({ taskGid: 'T-002', caseId: 'C-002', tenantId: 'other-tenant', state: 'completed' }),
      ],
      { nowMs: NOW }
    );
    expect(result.actions.length).toBe(1);
    expect(result.actions[0].caseId).toBe('C-001');
  });
});

describe('reconcileTenant — bulk', () => {
  it('handles multiple cases with mixed outcomes', () => {
    const cases: BrainCase[] = [
      brain({ caseId: 'C-agree', state: 'completed' }),
      brain({ caseId: 'C-ahead', state: 'awaiting_four_eyes' }),
      brain({ caseId: 'C-behind', state: 'completed' }),
      brain({ caseId: 'C-missing', state: 'awaiting_four_eyes' }),
    ];
    const tasks: AsanaTaskSnapshot[] = [
      task({ taskGid: 'T-agree', caseId: 'C-agree', state: 'completed' }),
      task({ taskGid: 'T-ahead', caseId: 'C-ahead', state: 'completed' }),
      task({ taskGid: 'T-behind', caseId: 'C-behind', state: 'open' }),
    ];
    const result = reconcileTenant(TENANT, cases, tasks, { nowMs: NOW });
    const kinds = result.actions.map((a) => a.kind).sort();
    expect(kinds).toEqual(
      [
        'advance_brain_to_completed',
        'flag_for_mlro_brain_ahead_of_asana',
        'flag_for_mlro_task_missing',
      ].sort()
    );
    expect(result.inAgreement).toEqual(['C-agree']);
  });
});
