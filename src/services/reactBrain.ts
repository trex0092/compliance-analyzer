/**
 * Agentic ReAct Brain — Thought → Action → Observation loop.
 *
 * This is the "thinking" core of Hawkeye. Given a compliance task, it
 * iterates: propose a THOUGHT, choose a tool ACTION, execute, ingest the
 * OBSERVATION, decide whether the problem is solved. Every step is
 * appended to a ReasoningChain DAG so the whole trajectory is
 * court-admissible and diffable.
 *
 * Differences vs. a vanilla LLM ReAct loop:
 *   1. Tools are whitelisted — the brain can ONLY call compliance tools
 *      we have audited (sanctions screening, risk scoring, etc.).
 *   2. Every action is checkpointed to the DAG before execution.
 *   3. A hard step budget prevents runaway loops.
 *   4. A "stop condition" callback lets the caller abort early if a
 *      sanctions hit is confirmed (per CLAUDE.md decision tree).
 *   5. The loop is PURE over a `ToolExecutor` abstraction — no network,
 *      no side effects from this module itself.
 *
 * Used by: reactBrain tests, hawkeye-mlro agent host, redTeamSimulator.ts.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20 — CO must document reasoning for every decision
 *   - Cabinet Res 134/2025 Art.19 — internal review traceability
 *   - FATF Rec 22/23 — DPMS reasoning must be auditable
 */

import {
  createChain,
  addNode,
  addEdge,
  seal,
  type ReasoningChain,
} from './reasoningChain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReactTool {
  name: string;
  description: string;
  /** Zero-arg safety — tool must validate its own args. */
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ReactStep {
  /** Monotonic 1-indexed step counter. */
  index: number;
  thought: string;
  action?: {
    tool: string;
    args: Record<string, unknown>;
  };
  observation?: unknown;
  error?: string;
  /** ISO timestamp when the step closed. */
  at: string;
}

export interface ReactRunResult {
  topic: string;
  completed: boolean;
  finalAnswer?: string;
  steps: ReactStep[];
  chain: ReasoningChain;
  stoppedReason:
    | 'final-answer'
    | 'stop-condition'
    | 'max-steps'
    | 'planner-empty'
    | 'tool-missing'
    | 'runtime-error';
}

/**
 * A Planner decides the next step given the history so far.
 * It returns either a new thought+action to run, or a final answer to stop.
 * In production this is backed by an LLM — but the brain itself is
 * planner-agnostic so we can swap in deterministic test planners.
 */
export interface Planner {
  plan: (ctx: PlannerContext) => Promise<PlannerDecision>;
}

export interface PlannerContext {
  topic: string;
  tools: readonly ReactTool[];
  history: readonly ReactStep[];
}

export type PlannerDecision =
  | { kind: 'act'; thought: string; tool: string; args: Record<string, unknown> }
  | { kind: 'final'; thought: string; answer: string }
  | { kind: 'abort'; reason: string };

export interface ReactBrainConfig {
  /** Hard upper bound on thought/action cycles. */
  maxSteps: number;
  /** Optional short-circuit: if this returns true the loop stops with `stop-condition`. */
  stopWhen?: (step: ReactStep) => boolean;
  /** Clock override for deterministic tests. */
  now?: () => string;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export async function runReactBrain(
  topic: string,
  tools: readonly ReactTool[],
  planner: Planner,
  config: ReactBrainConfig,
): Promise<ReactRunResult> {
  const clock = config.now ?? (() => new Date().toISOString());
  const chain = createChain(topic);
  addNode(chain, {
    id: 'topic',
    type: 'event',
    label: topic,
    weight: 1,
  });

  const history: ReactStep[] = [];
  let stoppedReason: ReactRunResult['stoppedReason'] = 'max-steps';
  let finalAnswer: string | undefined;
  let completed = false;
  let previousNodeId = 'topic';

  for (let i = 1; i <= config.maxSteps; i++) {
    let decision: PlannerDecision;
    try {
      decision = await planner.plan({ topic, tools, history });
    } catch (err) {
      stoppedReason = 'runtime-error';
      const step: ReactStep = {
        index: i,
        thought: '(planner error)',
        error: err instanceof Error ? err.message : String(err),
        at: clock(),
      };
      history.push(step);
      appendStepToChain(chain, step, previousNodeId);
      break;
    }

    if (decision.kind === 'final') {
      completed = true;
      finalAnswer = decision.answer;
      stoppedReason = 'final-answer';
      const finalId = `step-${i}`;
      addNode(chain, {
        id: finalId,
        type: 'decision',
        label: decision.thought,
        weight: 1,
        data: { answer: decision.answer },
      });
      addEdge(chain, {
        fromId: previousNodeId,
        toId: finalId,
        relation: 'implies',
        weight: 1,
        rationale: 'final-answer',
      });
      history.push({
        index: i,
        thought: decision.thought,
        observation: decision.answer,
        at: clock(),
      });
      break;
    }

    if (decision.kind === 'abort') {
      stoppedReason = 'planner-empty';
      history.push({
        index: i,
        thought: `(aborted) ${decision.reason}`,
        at: clock(),
      });
      break;
    }

    // decision.kind === 'act'
    const tool = tools.find((t) => t.name === decision.tool);
    if (!tool) {
      stoppedReason = 'tool-missing';
      const step: ReactStep = {
        index: i,
        thought: decision.thought,
        action: { tool: decision.tool, args: decision.args },
        error: `Tool not registered: ${decision.tool}`,
        at: clock(),
      };
      history.push(step);
      appendStepToChain(chain, step, previousNodeId);
      break;
    }

    const thoughtId = `thought-${i}`;
    const actionId = `action-${i}`;
    const observationId = `obs-${i}`;
    addNode(chain, { id: thoughtId, type: 'hypothesis', label: decision.thought, weight: 0.5 });
    addNode(chain, {
      id: actionId,
      type: 'action',
      label: `${decision.tool}(${JSON.stringify(decision.args)})`,
      weight: 0.7,
    });
    addEdge(chain, {
      fromId: previousNodeId,
      toId: thoughtId,
      relation: 'triggers',
      weight: 0.5,
    });
    addEdge(chain, {
      fromId: thoughtId,
      toId: actionId,
      relation: 'implies',
      weight: 0.7,
    });

    let observation: unknown;
    let error: string | undefined;
    try {
      observation = await tool.execute(decision.args);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    addNode(chain, {
      id: observationId,
      type: 'observation',
      label: error ? `ERR: ${error}` : summariseObservation(observation),
      weight: error ? 0.2 : 0.8,
      data: error ? { error } : { observation },
    });
    addEdge(chain, {
      fromId: actionId,
      toId: observationId,
      relation: error ? 'contradicts' : 'supports',
      weight: error ? 0.2 : 0.8,
    });
    previousNodeId = observationId;

    const step: ReactStep = {
      index: i,
      thought: decision.thought,
      action: { tool: decision.tool, args: decision.args },
      observation,
      error,
      at: clock(),
    };
    history.push(step);

    if (config.stopWhen?.(step)) {
      stoppedReason = 'stop-condition';
      break;
    }
  }

  seal(chain);
  return {
    topic,
    completed,
    finalAnswer,
    steps: history,
    chain,
    stoppedReason,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summariseObservation(obs: unknown): string {
  if (obs === null || obs === undefined) return '(no observation)';
  if (typeof obs === 'string') return obs.length > 160 ? `${obs.slice(0, 157)}...` : obs;
  try {
    const j = JSON.stringify(obs);
    return j.length > 160 ? `${j.slice(0, 157)}...` : j;
  } catch {
    return String(obs);
  }
}

function appendStepToChain(
  chain: ReasoningChain,
  step: ReactStep,
  parentId: string,
): void {
  const id = `step-${step.index}`;
  addNode(chain, {
    id,
    type: 'hypothesis',
    label: step.thought,
    weight: 0.3,
    data: step.error ? { error: step.error } : undefined,
  });
  addEdge(chain, {
    fromId: parentId,
    toId: id,
    relation: step.error ? 'contradicts' : 'triggers',
    weight: 0.3,
  });
}

// ---------------------------------------------------------------------------
// Deterministic scripted planner (for tests + replay)
// ---------------------------------------------------------------------------

/**
 * Wraps a static sequence of decisions into a Planner. Useful for
 * offline replay, golden tests, and red-team simulation. If the script
 * is exhausted it aborts the loop.
 */
export function scriptedPlanner(script: readonly PlannerDecision[]): Planner {
  let i = 0;
  return {
    plan: async () => {
      if (i >= script.length) {
        return { kind: 'abort', reason: 'scripted-planner-exhausted' };
      }
      return script[i++];
    },
  };
}
