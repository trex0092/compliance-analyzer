import { describe, it, expect, vi } from 'vitest';
import {
  runReactBrain,
  scriptedPlanner,
  type ReactTool,
  type PlannerDecision,
} from '@/services/reactBrain';

function fakeTool(name: string, fn: (args: Record<string, unknown>) => unknown): ReactTool {
  return {
    name,
    description: name,
    execute: async (args) => fn(args),
  };
}

describe('reactBrain — happy path', () => {
  it('runs scripted plan and returns final answer', async () => {
    const tools: ReactTool[] = [
      fakeTool('screen_entity', () => ({ matches: [{ name: 'John Doe', score: 0.95 }] })),
    ];
    const script: PlannerDecision[] = [
      {
        kind: 'act',
        thought: 'Need to check sanctions for John Doe',
        tool: 'screen_entity',
        args: { entityName: 'John Doe' },
      },
      {
        kind: 'final',
        thought: 'Confirmed sanctions hit — recommend freeze',
        answer: 'FREEZE: John Doe matched OFAC (0.95)',
      },
    ];
    const result = await runReactBrain('Assess John Doe', tools, scriptedPlanner(script), {
      maxSteps: 5,
    });
    expect(result.completed).toBe(true);
    expect(result.finalAnswer).toContain('FREEZE');
    expect(result.steps).toHaveLength(2);
    expect(result.stoppedReason).toBe('final-answer');
    expect(result.chain.sealed).toBe(true);
  });
});

describe('reactBrain — error handling', () => {
  it('records tool execution errors but continues loop', async () => {
    const tools: ReactTool[] = [
      fakeTool('screen_entity', () => {
        throw new Error('network down');
      }),
      fakeTool('score_risk', () => ({ score: 12 })),
    ];
    const script: PlannerDecision[] = [
      { kind: 'act', thought: 'screen', tool: 'screen_entity', args: {} },
      { kind: 'act', thought: 'score anyway', tool: 'score_risk', args: {} },
      { kind: 'final', thought: 'done', answer: 'medium risk' },
    ];
    const result = await runReactBrain('x', tools, scriptedPlanner(script), {
      maxSteps: 5,
    });
    expect(result.steps[0].error).toBe('network down');
    expect(result.steps[1].observation).toEqual({ score: 12 });
    expect(result.completed).toBe(true);
  });

  it('stops with tool-missing when planner calls unknown tool', async () => {
    const tools: ReactTool[] = [];
    const result = await runReactBrain(
      'x',
      tools,
      scriptedPlanner([{ kind: 'act', thought: 't', tool: 'ghost', args: {} }]),
      { maxSteps: 5 },
    );
    expect(result.stoppedReason).toBe('tool-missing');
    expect(result.completed).toBe(false);
  });

  it('stops with runtime-error when planner throws', async () => {
    const planner = {
      plan: vi.fn().mockRejectedValue(new Error('LLM timeout')),
    };
    const result = await runReactBrain('x', [], planner, { maxSteps: 5 });
    expect(result.stoppedReason).toBe('runtime-error');
    expect(result.steps[0].error).toContain('LLM timeout');
  });
});

describe('reactBrain — safety limits', () => {
  it('honors max-steps budget', async () => {
    const tools: ReactTool[] = [fakeTool('noop', () => 'ok')];
    const loopPlanner = {
      plan: async () => ({
        kind: 'act' as const,
        thought: 'again',
        tool: 'noop',
        args: {},
      }),
    };
    const result = await runReactBrain('infinite', tools, loopPlanner, { maxSteps: 3 });
    expect(result.steps).toHaveLength(3);
    expect(result.stoppedReason).toBe('max-steps');
  });

  it('short-circuits on stopWhen condition', async () => {
    const tools: ReactTool[] = [
      fakeTool('screen_entity', () => ({ confirmed: true, score: 0.99 })),
    ];
    const result = await runReactBrain(
      'John',
      tools,
      scriptedPlanner([
        { kind: 'act', thought: 'screen', tool: 'screen_entity', args: {} },
        { kind: 'act', thought: 'more', tool: 'screen_entity', args: {} },
      ]),
      {
        maxSteps: 10,
        stopWhen: (s) =>
          !!s.observation &&
          typeof s.observation === 'object' &&
          (s.observation as { confirmed?: boolean }).confirmed === true,
      },
    );
    expect(result.stoppedReason).toBe('stop-condition');
    expect(result.steps).toHaveLength(1);
  });
});

describe('reactBrain — DAG invariant', () => {
  it('chain is sealed and contains topic + action + observation nodes', async () => {
    const tools: ReactTool[] = [fakeTool('screen_entity', () => 'clean')];
    const result = await runReactBrain(
      'test',
      tools,
      scriptedPlanner([
        { kind: 'act', thought: 'check', tool: 'screen_entity', args: { name: 'A' } },
        { kind: 'final', thought: 'done', answer: 'clean' },
      ]),
      { maxSteps: 5 },
    );
    expect(result.chain.sealed).toBe(true);
    const types = result.chain.nodes.map((n) => n.type);
    expect(types).toContain('event');
    expect(types).toContain('action');
    expect(types).toContain('observation');
    expect(types).toContain('decision');
  });
});
