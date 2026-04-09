/**
 * Orchestration Engine
 *
 * Manages multi-agent workflows with step sequencing, parallel execution,
 * error handling, and automatic retry. This is the "Orchestration" box
 * from the Agent SDK architecture diagram.
 *
 * Workflows are defined as DAGs of steps, where each step runs an agent
 * or a tool call. Steps can depend on previous steps, enabling both
 * sequential and parallel execution.
 */

import type { ComplianceMCPServer } from '../mcp-server';
import type { SessionManager, AgentMessage } from '../session/manager';
import { ORCHESTRATION_CONFIG } from '../config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface WorkflowStep {
  id: string;
  name: string;
  /** IDs of steps that must complete before this one runs */
  dependsOn: string[];
  /** The agent or tool to execute */
  execute: (context: StepContext) => Promise<StepResult>;
  /** Optional condition — if false, step is skipped */
  condition?: (context: StepContext) => boolean;
  /** Maximum retries for this step */
  maxRetries?: number;
}

export interface StepContext {
  server: ComplianceMCPServer;
  session: SessionManager;
  /** Results from previously completed steps, keyed by step ID */
  previousResults: Map<string, StepResult>;
  /** Shared workflow data (mutable across steps) */
  workflowData: Record<string, unknown>;
}

export interface StepResult {
  stepId: string;
  status: StepStatus;
  data?: unknown;
  error?: string;
  durationMs: number;
  retryCount: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
}

export interface WorkflowExecution {
  workflowId: string;
  workflowName: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  stepResults: Map<string, StepResult>;
  messages: AgentMessage[];
  totalDurationMs: number;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class OrchestrationEngine {
  private server: ComplianceMCPServer;
  private session: SessionManager;

  constructor(server: ComplianceMCPServer, session: SessionManager) {
    this.server = server;
    this.session = session;
  }

  /**
   * Execute a workflow definition.
   * Steps run in topological order — steps with no unresolved dependencies
   * run in parallel (up to maxConcurrentAgents).
   */
  async executeWorkflow(workflow: WorkflowDefinition): Promise<WorkflowExecution> {
    const startTime = Date.now();
    const stepResults = new Map<string, StepResult>();
    const workflowData: Record<string, unknown> = {};
    const messages: AgentMessage[] = [];

    const log = (content: string) => {
      const msg: AgentMessage = { role: 'system', content, timestamp: new Date().toISOString() };
      messages.push(msg);
      this.session.addMessage(msg);
    };

    log(`Workflow "${workflow.name}" started — ${workflow.steps.length} steps`);

    const completed = new Set<string>();
    const failed = new Set<string>();
    const remaining = new Set(workflow.steps.map((s) => s.id));

    while (remaining.size > 0) {
      // Find steps whose dependencies are all completed
      const ready = workflow.steps.filter(
        (step) =>
          remaining.has(step.id) &&
          step.dependsOn.every((dep) => completed.has(dep)),
      );

      if (ready.length === 0 && remaining.size > 0) {
        // Deadlock — some steps depend on failed steps
        log(`Workflow ABORTED — deadlock detected. Failed dependencies block ${remaining.size} remaining step(s).`);
        break;
      }

      // Check if any ready steps should be skipped due to failed dependencies
      const runnableSteps = ready.filter((step) => {
        // Skip if any dependency failed
        if (step.dependsOn.some((dep) => failed.has(dep))) {
          const result: StepResult = {
            stepId: step.id,
            status: 'skipped',
            error: 'Dependency failed',
            durationMs: 0,
            retryCount: 0,
          };
          stepResults.set(step.id, result);
          remaining.delete(step.id);
          log(`Step "${step.name}" SKIPPED — dependency failed`);
          return false;
        }
        return true;
      });

      // Run ready steps in parallel (limited concurrency)
      const batch = runnableSteps.slice(0, ORCHESTRATION_CONFIG.maxConcurrentAgents);

      const batchResults = await Promise.allSettled(
        batch.map((step) => this.executeStep(step, stepResults, workflowData, log)),
      );

      for (let i = 0; i < batch.length; i++) {
        const step = batch[i];
        const settled = batchResults[i];

        let result: StepResult;
        if (settled.status === 'fulfilled') {
          result = settled.value;
        } else {
          result = {
            stepId: step.id,
            status: 'failed',
            error: settled.reason?.message ?? String(settled.reason),
            durationMs: 0,
            retryCount: 0,
          };
        }

        stepResults.set(step.id, result);
        remaining.delete(step.id);

        if (result.status === 'completed') {
          completed.add(step.id);
          log(`Step "${step.name}" COMPLETED (${result.durationMs}ms)`);
        } else if (result.status === 'skipped') {
          completed.add(step.id); // skipped still unblocks dependents
          log(`Step "${step.name}" SKIPPED`);
        } else {
          failed.add(step.id);
          log(`Step "${step.name}" FAILED: ${result.error}`);
        }
      }
    }

    const overallStatus = failed.size > 0 ? 'failed' : remaining.size > 0 ? 'aborted' : 'completed';
    const totalDurationMs = Date.now() - startTime;

    log(`Workflow "${workflow.name}" ${overallStatus} — ${completed.size} completed, ${failed.size} failed (${totalDurationMs}ms)`);

    return {
      workflowId: workflow.id,
      workflowName: workflow.name,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      status: overallStatus,
      stepResults,
      messages,
      totalDurationMs,
    };
  }

  /** Execute a single step with retry logic */
  private async executeStep(
    step: WorkflowStep,
    previousResults: Map<string, StepResult>,
    workflowData: Record<string, unknown>,
    log: (msg: string) => void,
  ): Promise<StepResult> {
    const context: StepContext = {
      server: this.server,
      session: this.session,
      previousResults,
      workflowData,
    };

    // Check condition
    if (step.condition && !step.condition(context)) {
      return {
        stepId: step.id,
        status: 'skipped',
        durationMs: 0,
        retryCount: 0,
      };
    }

    const maxRetries = step.maxRetries ?? ORCHESTRATION_CONFIG.maxRetries;
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        log(`Retrying step "${step.name}" (attempt ${attempt + 1}/${maxRetries + 1})`);
        await sleep(ORCHESTRATION_CONFIG.retryDelayMs * attempt);
      }

      const start = Date.now();
      try {
        const result = await withTimeout(
          step.execute(context),
          ORCHESTRATION_CONFIG.stepTimeoutMs,
        );

        return {
          ...result,
          durationMs: Date.now() - start,
          retryCount: attempt,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        log(`Step "${step.name}" attempt ${attempt + 1} failed: ${lastError}`);
      }
    }

    return {
      stepId: step.id,
      status: 'failed',
      error: lastError,
      durationMs: 0,
      retryCount: maxRetries,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Step timed out after ${ms}ms`)), ms);
    promise
      .then((val) => { clearTimeout(timer); resolve(val); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}
