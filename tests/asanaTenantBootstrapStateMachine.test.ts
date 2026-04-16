/**
 * Tests for asanaTenantBootstrapStateMachine.ts — pure compute.
 * All wall-clock values are synthetic.
 */
import { describe, it, expect } from 'vitest';
import {
  STEPS,
  initialState,
  planBootstrap,
  withStepState,
} from '@/services/asanaTenantBootstrapStateMachine';

const NOW = 1_750_000_000_000;

describe('initialState + planBootstrap — brand-new tenant', () => {
  it('returns the first step as next, everything else queued behind it', () => {
    const state = initialState('madison-llc', NOW);
    const plan = planBootstrap(state, { nowMs: NOW });
    expect(plan.nextSteps).toEqual([STEPS[0]]);
    expect(plan.alreadyDone).toEqual([]);
    expect(plan.failed).toEqual([]);
    expect(plan.inProgressFresh).toEqual([]);
    expect(plan.complete).toBe(false);
  });

  it('tenantId is carried through', () => {
    const state = initialState('zoe-fze', NOW);
    const plan = planBootstrap(state, { nowMs: NOW });
    expect(plan.tenantId).toBe('zoe-fze');
  });
});

describe('planBootstrap — ordering', () => {
  it('only releases the next step once the predecessor is done', () => {
    let state = initialState('madison-llc', NOW);
    state = withStepState(state, 'validate_inputs', { state: 'done' }, NOW);
    const plan = planBootstrap(state, { nowMs: NOW });
    expect(plan.nextSteps).toEqual(['create_project_compliance']);
    expect(plan.alreadyDone).toEqual(['validate_inputs']);
  });

  it('skips completed steps but schedules the first pending one', () => {
    let state = initialState('madison-llc', NOW);
    for (const step of STEPS.slice(0, 4)) {
      state = withStepState(state, step, { state: 'done' }, NOW);
    }
    const plan = planBootstrap(state, { nowMs: NOW });
    expect(plan.alreadyDone.length).toBe(4);
    expect(plan.nextSteps).toEqual(['provision_custom_fields']);
  });
});

describe('planBootstrap — completion', () => {
  it('complete=true when every step is done', () => {
    let state = initialState('madison-llc', NOW);
    for (const step of STEPS) {
      state = withStepState(state, step, { state: 'done' }, NOW);
    }
    const plan = planBootstrap(state, { nowMs: NOW });
    expect(plan.complete).toBe(true);
    expect(plan.nextSteps).toEqual([]);
    expect(plan.alreadyDone.length).toBe(STEPS.length);
  });
});

describe('planBootstrap — failure retry (fix-forward)', () => {
  it('a failed step is returned as the next step to retry', () => {
    let state = initialState('madison-llc', NOW);
    state = withStepState(state, 'validate_inputs', { state: 'done' }, NOW);
    state = withStepState(
      state,
      'create_project_compliance',
      { state: 'failed', error: 'asana 429' },
      NOW
    );
    const plan = planBootstrap(state, { nowMs: NOW });
    expect(plan.nextSteps).toEqual(['create_project_compliance']);
    expect(plan.failed).toEqual(['create_project_compliance']);
  });

  it('a failed step blocks its successors from running', () => {
    let state = initialState('madison-llc', NOW);
    state = withStepState(state, 'validate_inputs', { state: 'done' }, NOW);
    state = withStepState(state, 'create_project_compliance', { state: 'failed', error: 'x' }, NOW);
    const plan = planBootstrap(state, { nowMs: NOW });
    // create_project_workflow is a successor and must not run yet.
    expect(plan.nextSteps).not.toContain('create_project_workflow');
  });
});

describe('planBootstrap — in_progress', () => {
  it('fresh in_progress blocks further progress but is not restarted', () => {
    let state = initialState('madison-llc', NOW);
    state = withStepState(state, 'validate_inputs', { state: 'done' }, NOW);
    state = withStepState(
      state,
      'create_project_compliance',
      { state: 'in_progress' },
      NOW - 60_000 // 1 minute old — not stale yet at default 10 min
    );
    const plan = planBootstrap(state, { nowMs: NOW });
    expect(plan.inProgressFresh).toEqual(['create_project_compliance']);
    expect(plan.nextSteps).toEqual([]);
  });

  it('stale in_progress is re-scheduled', () => {
    let state = initialState('madison-llc', NOW);
    state = withStepState(state, 'validate_inputs', { state: 'done' }, NOW);
    state = withStepState(
      state,
      'create_project_compliance',
      { state: 'in_progress' },
      NOW - 20 * 60 * 1000 // 20 min old
    );
    const plan = planBootstrap(state, { nowMs: NOW });
    expect(plan.nextSteps).toEqual(['create_project_compliance']);
    expect(plan.inProgressFresh).toEqual([]);
  });

  it('staleInProgressMs override is respected', () => {
    let state = initialState('madison-llc', NOW);
    state = withStepState(state, 'validate_inputs', { state: 'done' }, NOW);
    state = withStepState(
      state,
      'create_project_compliance',
      { state: 'in_progress' },
      NOW - 30_000 // 30 sec
    );
    // Strict 15s threshold — 30s age is stale.
    const plan = planBootstrap(state, { nowMs: NOW, staleInProgressMs: 15_000 });
    expect(plan.nextSteps).toEqual(['create_project_compliance']);
  });
});

describe('withStepState — immutability', () => {
  it('returns a new object; original is not mutated', () => {
    const original = initialState('madison-llc', NOW);
    const updated = withStepState(original, 'validate_inputs', { state: 'done' }, NOW);
    expect(original.steps.validate_inputs).toBeUndefined();
    expect(updated.steps.validate_inputs?.state).toBe('done');
  });

  it('preserves output across state transitions when not overridden', () => {
    let state = initialState('madison-llc', NOW);
    state = withStepState(
      state,
      'create_project_compliance',
      { state: 'in_progress', output: { projectGid: 'GID-123' } },
      NOW
    );
    state = withStepState(state, 'create_project_compliance', { state: 'done' }, NOW + 1_000);
    expect(state.steps.create_project_compliance?.output).toEqual({
      projectGid: 'GID-123',
    });
  });

  it('clears error on non-failed transitions', () => {
    let state = initialState('madison-llc', NOW);
    state = withStepState(state, 'register_webhook', { state: 'failed', error: 'asana 503' }, NOW);
    expect(state.steps.register_webhook?.error).toBe('asana 503');
    state = withStepState(state, 'register_webhook', { state: 'done' }, NOW + 1);
    expect(state.steps.register_webhook?.error).toBeUndefined();
  });
});

describe('STEPS — shape', () => {
  it('has the expected ordered sequence', () => {
    expect(STEPS).toEqual([
      'validate_inputs',
      'create_project_compliance',
      'create_project_workflow',
      'create_sections',
      'provision_custom_fields',
      'emit_custom_field_env_vars',
      'register_webhook',
      'seed_idempotency_namespace',
      'write_registry_row',
    ]);
  });
});

describe('end-to-end resume scenario', () => {
  it('kill mid-flight + resume five times converges on complete', () => {
    let state = initialState('madison-llc', NOW);
    let now = NOW;
    const killAt = [2, 4, 6, 8, STEPS.length];

    for (const k of killAt) {
      // Execute up to index k - 1 as done.
      for (let i = 0; i < k && i < STEPS.length; i++) {
        const step = STEPS[i];
        if (state.steps[step]?.state === 'done') continue;
        state = withStepState(state, step, { state: 'done' }, now++);
      }
      if (k < STEPS.length) {
        // The next step gets in_progress then stale.
        state = withStepState(
          state,
          STEPS[k],
          { state: 'in_progress' },
          now - 60 * 60 * 1000 // make it stale
        );
      }
      const plan = planBootstrap(state, { nowMs: now });
      if (k === STEPS.length) {
        expect(plan.complete).toBe(true);
      } else {
        expect(plan.nextSteps[0]).toBe(STEPS[k]);
      }
    }
    const finalPlan = planBootstrap(state, { nowMs: now });
    expect(finalPlan.complete).toBe(true);
  });
});
