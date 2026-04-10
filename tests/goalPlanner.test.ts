import { describe, it, expect } from 'vitest';
import { plan, STR_FILING_ACTIONS, FREEZE_ACTIONS } from '@/services/goalPlanner';

describe('goalPlanner — STR filing plan', () => {
  it('builds a full plan from empty state to strFiled + caseClosed', () => {
    const p = plan({
      initialState: new Set(),
      goal: ['strFiled', 'caseClosed'],
      actions: STR_FILING_ACTIONS,
    });
    expect(p.satisfiedGoal).toBe(true);
    const names = p.steps.map((s) => s.name);
    expect(names).toContain('screen_entity');
    expect(names).toContain('submit_to_fiu');
    expect(names.indexOf('screen_entity')).toBeLessThan(names.indexOf('draft_str_narrative'));
    expect(names.indexOf('draft_str_narrative')).toBeLessThan(
      names.indexOf('submit_to_fiu'),
    );
    expect(p.totalEstimatedHours).toBeGreaterThan(0);
  });

  it('skips actions whose effects are already in initial state', () => {
    const p = plan({
      initialState: new Set(['entityScreened', 'evidenceCollected', 'redFlagsIdentified']),
      goal: ['strFiled'],
      actions: STR_FILING_ACTIONS,
    });
    expect(p.steps.some((s) => s.name === 'screen_entity')).toBe(false);
    expect(p.steps.some((s) => s.name === 'draft_str_narrative')).toBe(true);
  });

  it('returns empty plan when goal already satisfied', () => {
    const p = plan({
      initialState: new Set(['strFiled']),
      goal: ['strFiled'],
      actions: STR_FILING_ACTIONS,
    });
    expect(p.steps).toHaveLength(0);
    expect(p.satisfiedGoal).toBe(true);
  });
});

describe('goalPlanner — freeze plan', () => {
  it('builds the full freeze → EOCN → CNMR sequence', () => {
    const p = plan({
      initialState: new Set(),
      goal: ['cnmrFiled'],
      actions: FREEZE_ACTIONS,
    });
    const names = p.steps.map((s) => s.name);
    expect(names).toEqual([
      'verify_sanctions_match',
      'initiate_freeze',
      'notify_eocn',
      'file_cnmr',
    ]);
    // Regulatory references are attached
    expect(p.steps[2].regulatoryRef).toContain('74/2020');
  });
});

describe('goalPlanner — unreachable goals', () => {
  it('returns unsatisfied plan when no action achieves the goal', () => {
    const p = plan({
      initialState: new Set(),
      goal: ['moonLanding'],
      actions: STR_FILING_ACTIONS,
    });
    expect(p.satisfiedGoal).toBe(false);
    expect(p.steps).toHaveLength(0);
    expect(p.notes.join(' ')).toMatch(/moonLanding/);
  });
});
