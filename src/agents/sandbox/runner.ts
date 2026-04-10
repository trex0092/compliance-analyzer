/**
 * Sandbox Runner
 *
 * Provides isolated execution for risky compliance operations.
 * This is the "Sandbox" box from the Agent SDK architecture diagram.
 *
 * Sandboxed operations:
 * - Sanctions screening (network calls to external lists)
 * - goAML XML validation (parsing untrusted XML)
 * - Risk score simulations (what-if analysis)
 * - Batch screening (high-volume parallel processing)
 *
 * Safety features:
 * - Execution timeout enforcement
 * - Error isolation (failures don't crash the harness)
 * - Result validation before returning to harness
 * - Full audit logging of sandbox operations
 */

import { SANDBOX_CONFIG } from '../config';
import type { ComplianceMCPServer, ToolCallRequest, ToolCallResponse } from '../mcp-server';
import type { SessionManager, AgentMessage } from '../session/manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SandboxedOperation = (typeof SANDBOX_CONFIG.sandboxedOperations)[number];

export interface SandboxResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  executionTimeMs: number;
  sandboxed: true;
  operationType: string;
  auditId: string;
}

export interface SandboxOptions {
  /** Override default timeout (ms) */
  timeoutMs?: number;
  /** Whether to validate results before returning */
  validateResults?: boolean;
  /** Dry run — log but don't execute */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// Sandbox Runner
// ---------------------------------------------------------------------------

export class SandboxRunner {
  private server: ComplianceMCPServer;
  private session: SessionManager;

  constructor(server: ComplianceMCPServer, session: SessionManager) {
    this.server = server;
    this.session = session;
  }

  /**
   * Execute a tool call inside the sandbox.
   * Wraps the call with timeout, error isolation, and audit logging.
   */
  async execute<T = unknown>(
    operation: string,
    toolCall: ToolCallRequest,
    options: SandboxOptions = {}
  ): Promise<SandboxResult<T>> {
    const auditId = crypto.randomUUID();
    const start = Date.now();
    const timeoutMs = options.timeoutMs ?? SANDBOX_CONFIG.executionTimeoutMs;

    const log = (content: string) => {
      const msg: AgentMessage = {
        role: 'system',
        content: `[Sandbox] ${content}`,
        timestamp: new Date().toISOString(),
      };
      this.session.addMessage(msg);
    };

    log(`Starting ${operation} — tool: ${toolCall.name}, timeout: ${timeoutMs}ms`);

    // Audit trail entry
    await this.session.logAudit(
      'sandbox-start',
      `Sandbox ${operation}: ${toolCall.name} (id: ${auditId})`
    );

    if (options.dryRun) {
      log(`DRY RUN — skipping execution of ${toolCall.name}`);
      return {
        success: true,
        data: { dryRun: true, toolName: toolCall.name } as T,
        executionTimeMs: Date.now() - start,
        sandboxed: true,
        operationType: operation,
        auditId,
      };
    }

    try {
      const result = await this.executeWithTimeout(toolCall, timeoutMs);
      const executionTimeMs = Date.now() - start;

      if (!result.result.ok) {
        log(`${operation} failed: ${result.result.error}`);
        await this.session.logAudit(
          'sandbox-error',
          `Sandbox ${operation} failed: ${result.result.error} (id: ${auditId})`
        );

        return {
          success: false,
          error: result.result.error,
          executionTimeMs,
          sandboxed: true,
          operationType: operation,
          auditId,
        };
      }

      // Validate results if requested
      if (options.validateResults) {
        const validationError = this.validateResult(operation, result);
        if (validationError) {
          log(`${operation} result validation failed: ${validationError}`);
          return {
            success: false,
            error: `Validation failed: ${validationError}`,
            executionTimeMs,
            sandboxed: true,
            operationType: operation,
            auditId,
          };
        }
      }

      log(`${operation} completed successfully (${executionTimeMs}ms)`);
      await this.session.logAudit(
        'sandbox-complete',
        `Sandbox ${operation} completed (${executionTimeMs}ms, id: ${auditId})`
      );

      return {
        success: true,
        data: result.result.data as T,
        executionTimeMs,
        sandboxed: true,
        operationType: operation,
        auditId,
      };
    } catch (err) {
      const executionTimeMs = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);

      log(`${operation} threw error: ${errorMsg}`);
      await this.session.logAudit(
        'sandbox-error',
        `Sandbox ${operation} error: ${errorMsg} (id: ${auditId})`
      );

      return {
        success: false,
        error: errorMsg,
        executionTimeMs,
        sandboxed: true,
        operationType: operation,
        auditId,
      };
    }
  }

  /**
   * Run a batch of tool calls in parallel inside the sandbox.
   * Each call is independently isolated — one failure doesn't stop others.
   */
  async executeBatch<T = unknown>(
    operation: string,
    toolCalls: ToolCallRequest[],
    options: SandboxOptions = {}
  ): Promise<SandboxResult<T[]>> {
    const auditId = crypto.randomUUID();
    const start = Date.now();

    await this.session.logAudit(
      'sandbox-batch-start',
      `Batch ${operation}: ${toolCalls.length} calls (id: ${auditId})`
    );

    const results = await Promise.allSettled(
      toolCalls.map((tc) => this.execute<T>(operation, tc, options))
    );

    const successful: T[] = [];
    const errors: string[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        if (result.value.data) successful.push(result.value.data);
      } else {
        const error =
          result.status === 'rejected'
            ? String(result.reason)
            : (result.value.error ?? 'Unknown error');
        errors.push(error);
      }
    }

    const executionTimeMs = Date.now() - start;
    const allSucceeded = errors.length === 0;

    await this.session.logAudit(
      'sandbox-batch-complete',
      `Batch ${operation}: ${successful.length}/${toolCalls.length} succeeded (${executionTimeMs}ms, id: ${auditId})`
    );

    return {
      success: allSucceeded,
      data: successful,
      error: errors.length > 0 ? `${errors.length} call(s) failed: ${errors[0]}` : undefined,
      executionTimeMs,
      sandboxed: true,
      operationType: `batch-${operation}`,
      auditId,
    };
  }

  /**
   * Simulate a risk score change without persisting.
   * Useful for "what-if" analysis.
   */
  async simulateRiskScore(
    flagCodes: string[],
    context: Record<string, boolean>
  ): Promise<SandboxResult<{ baseScore: number; adjustedScore: number; riskLevel: string }>> {
    return this.execute(
      'risk-score-simulation',
      {
        name: 'score_risk',
        arguments: { flagCodes, context },
      },
      { validateResults: false }
    );
  }

  // ---- Internals ----

  private async executeWithTimeout(
    toolCall: ToolCallRequest,
    timeoutMs: number
  ): Promise<ToolCallResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Sandbox timeout after ${timeoutMs}ms`)),
        timeoutMs
      );

      this.server
        .callTool(toolCall)
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private validateResult(operation: string, response: ToolCallResponse): string | null {
    if (operation === 'goaml-validation') {
      const data = response.result.data as { valid?: boolean; errors?: unknown[] } | undefined;
      if (data && !data.valid && data.errors && (data.errors as unknown[]).length > 0) {
        return `goAML XML has ${(data.errors as unknown[]).length} validation error(s)`;
      }
    }
    return null;
  }
}
