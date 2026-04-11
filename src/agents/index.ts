/**
 * Compliance Agent SDK — Entry Point
 *
 * This is the "Harness" from the Agent SDK architecture diagram.
 * It ties together all five components:
 *
 *   ┌──────────────────┐
 *   │ Tools + Resources │  ← ComplianceMCPServer
 *   │      / MCP        │
 *   └────────┬─────────┘
 *            │
 *   ┌────────▼─────────┐
 *   │     Harness       │  ← ComplianceHarness (this file)
 *   │  (orchestrates)   │
 *   └──┬─────┬──────┬──┘
 *      │     │      │
 *  ┌───▼──┐ ┌▼────┐ ┌▼────────┐
 *  │Session│ │Sand-│ │Orchestr-│
 *  │      │ │box  │ │ation    │
 *  └──────┘ └─────┘ └─────────┘
 *
 * Usage:
 *   import { ComplianceHarness } from './agents';
 *   const harness = new ComplianceHarness({ analyst: 'John Doe' });
 *   const result = await harness.screenEntity('Al Farooq Trading LLC');
 */

import { ComplianceMCPServer, type MCPServerContext } from './mcp-server';
import { SessionManager } from './session/manager';
import { SandboxRunner } from './sandbox/runner';
import { OrchestrationEngine } from './orchestration/engine';
import {
  createOnboardingWorkflow,
  createIncidentWithFilingWorkflow,
  createPeriodicReviewWorkflow,
  createBatchScreeningWorkflow,
} from './orchestration/workflows';
import { runScreeningAgent, type ScreeningAgentResult } from './definitions/screening-agent';
import { runOnboardingAgent, type OnboardingAgentResult } from './definitions/onboarding-agent';
import {
  runIncidentAgent,
  type IncidentAgentConfig,
  type IncidentAgentResult,
} from './definitions/incident-agent';
import {
  runFilingAgent,
  type FilingAgentConfig,
  type FilingAgentResult,
} from './definitions/filing-agent';
import {
  runAuditAgent,
  type AuditAgentConfig,
  type AuditAgentResult,
} from './definitions/audit-agent';
import {
  runAiGovernanceAgent,
  type AiGovernanceAgentConfig,
  type AiGovernanceAgentResult,
} from './definitions/ai-governance-agent';

import type { CustomerProfile } from '../domain/customers';
import type { ComplianceCase } from '../domain/cases';
import type { SuspicionReport } from '../domain/reports';
import type { WorkflowExecution } from './orchestration/engine';

// ---------------------------------------------------------------------------
// Harness Configuration
// ---------------------------------------------------------------------------

export interface HarnessConfig {
  analyst: string;
  apiKey?: string;
  onSessionExpire?: () => void;
}

// ---------------------------------------------------------------------------
// Compliance Harness
// ---------------------------------------------------------------------------

export class ComplianceHarness {
  readonly session: SessionManager;
  readonly server: ComplianceMCPServer;
  readonly sandbox: SandboxRunner;
  readonly orchestrator: OrchestrationEngine;

  constructor(config: HarnessConfig) {
    // Session — conversation state & audit trail
    this.session = new SessionManager(config.analyst, config.onSessionExpire);

    // MCP Server — tool registry & dispatch
    const serverContext: MCPServerContext = {
      auditChain: this.session.getAuditChain(),
      analyst: config.analyst,
      apiKey: config.apiKey,
    };
    this.server = new ComplianceMCPServer(serverContext);

    // Sandbox — isolated execution
    this.sandbox = new SandboxRunner(this.server, this.session);

    // Orchestration — multi-step workflows
    this.orchestrator = new OrchestrationEngine(this.server, this.session);
  }

  // -----------------------------------------------------------------------
  // High-level agent operations (simple API for common tasks)
  // -----------------------------------------------------------------------

  /** Screen an entity against all sanctions lists */
  async screenEntity(
    entityName: string,
    options?: { depth?: 'basic' | 'enhanced' | 'full'; entityType?: 'individual' | 'entity' }
  ): Promise<ScreeningAgentResult> {
    return runScreeningAgent(
      {
        entityName,
        entityType: options?.entityType ?? 'entity',
        depth: options?.depth ?? 'enhanced',
      },
      this.server,
      this.session
    );
  }

  /** Onboard a new customer (screen → score → tier → case → approvals) */
  async onboardCustomer(
    customer: CustomerProfile,
    redFlagCodes?: string[]
  ): Promise<OnboardingAgentResult> {
    return runOnboardingAgent({ customer, redFlagCodes }, this.server, this.session);
  }

  /** Handle a compliance incident with regulatory countdowns */
  async handleIncident(config: IncidentAgentConfig): Promise<IncidentAgentResult> {
    return runIncidentAgent(config, this.server, this.session);
  }

  /** Generate and validate a compliance filing */
  async generateFiling(config: FilingAgentConfig): Promise<FilingAgentResult> {
    return runFilingAgent(config, this.server, this.session);
  }

  /** Run compliance audit */
  async runAudit(config: AuditAgentConfig): Promise<AuditAgentResult> {
    return runAuditAgent(config, this.server, this.session);
  }

  /**
   * Run an AI governance audit against the four frameworks
   * (EU AI Act, NIST AI RMF, ISO/IEC 42001, UAE AI Governance).
   *
   * Supports both self-audit (audits the compliance-analyzer itself
   * against the self-audit evidence baseline) and customer audit
   * (caller provides the evidence map).
   *
   * Regulatory basis:
   *   - EU Reg 2024/1689 Art.27 (deployer obligations, full
   *     enforcement August 2026)
   *   - NIST AI RMF 1.0 (Govern, Map, Measure, Manage)
   *   - ISO/IEC 42001:2023 Clause 9 (performance evaluation)
   *   - UAE AI Charter + National AI Strategy 2031
   */
  runAiGovernanceAudit(config: AiGovernanceAgentConfig): AiGovernanceAgentResult {
    return runAiGovernanceAgent(config);
  }

  // -----------------------------------------------------------------------
  // Orchestrated workflows (multi-agent pipelines)
  // -----------------------------------------------------------------------

  /** Full onboarding workflow with incident handling if blocked */
  async runOnboardingWorkflow(
    customer: CustomerProfile,
    redFlagCodes?: string[]
  ): Promise<WorkflowExecution> {
    const workflow = createOnboardingWorkflow(customer, redFlagCodes);
    return this.orchestrator.executeWorkflow(workflow);
  }

  /** Incident response with automatic filing generation */
  async runIncidentWorkflow(
    entityId: string,
    entityName: string,
    incidentType: 'sanctions-match' | 'str-trigger',
    report?: SuspicionReport
  ): Promise<WorkflowExecution> {
    const workflow = createIncidentWithFilingWorkflow(entityId, entityName, incidentType, report);
    return this.orchestrator.executeWorkflow(workflow);
  }

  /** Periodic review: CDD scan + re-screen + audit report */
  async runPeriodicReview(
    entity: string,
    customers: CustomerProfile[],
    cases: ComplianceCase[],
    period: string
  ): Promise<WorkflowExecution> {
    const workflow = createPeriodicReviewWorkflow(
      entity,
      customers,
      cases,
      period,
      this.session.getMetadata().analyst
    );
    return this.orchestrator.executeWorkflow(workflow);
  }

  /** Batch screen multiple entities in parallel */
  async runBatchScreening(
    entities: Array<{ name: string; type: 'individual' | 'entity' }>
  ): Promise<WorkflowExecution> {
    const workflow = createBatchScreeningWorkflow(entities);
    return this.orchestrator.executeWorkflow(workflow);
  }

  // -----------------------------------------------------------------------
  // Sandbox operations (isolated execution)
  // -----------------------------------------------------------------------

  /** Simulate risk score change (what-if analysis) */
  async simulateRiskScore(flagCodes: string[], context: Record<string, boolean>) {
    return this.sandbox.simulateRiskScore(flagCodes, context);
  }

  /** Run tool call inside sandbox with timeout and error isolation */
  async sandboxedToolCall(toolName: string, args: Record<string, unknown>) {
    return this.sandbox.execute(toolName, { name: toolName, arguments: args });
  }

  // -----------------------------------------------------------------------
  // Direct tool access
  // -----------------------------------------------------------------------

  /** List all available MCP tools */
  listTools() {
    return this.server.listTools();
  }

  /** Call a specific tool directly */
  async callTool(name: string, args: Record<string, unknown>) {
    return this.server.callTool({ name, arguments: args });
  }

  // -----------------------------------------------------------------------
  // Session management
  // -----------------------------------------------------------------------

  /** Get session snapshot for persistence */
  getSessionSnapshot() {
    return this.session.snapshot();
  }

  /** Get audit trail */
  getAuditChain() {
    return this.session.getAuditChain();
  }

  /** Verify audit trail integrity */
  async verifyAuditChain() {
    return this.session.verifyAuditChain();
  }

  /** End session cleanly */
  endSession() {
    this.session.complete();
  }

  /** Destroy session and clean up timers */
  destroy() {
    this.session.destroy();
  }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { ComplianceMCPServer } from './mcp-server';
export { SessionManager } from './session/manager';
export { SandboxRunner } from './sandbox/runner';
export { OrchestrationEngine } from './orchestration/engine';
export {
  createOnboardingWorkflow,
  createIncidentWithFilingWorkflow,
  createPeriodicReviewWorkflow,
  createBatchScreeningWorkflow,
} from './orchestration/workflows';

// Agent definitions
export { runScreeningAgent } from './definitions/screening-agent';
export { runOnboardingAgent } from './definitions/onboarding-agent';
export { runIncidentAgent } from './definitions/incident-agent';
export { runFilingAgent } from './definitions/filing-agent';
export { runAuditAgent } from './definitions/audit-agent';
export { runAiGovernanceAgent } from './definitions/ai-governance-agent';

// Types
export type { ScreeningAgentConfig, ScreeningAgentResult } from './definitions/screening-agent';
export type { OnboardingAgentConfig, OnboardingAgentResult } from './definitions/onboarding-agent';
export type { IncidentAgentConfig, IncidentAgentResult } from './definitions/incident-agent';
export type { FilingAgentConfig, FilingAgentResult } from './definitions/filing-agent';
export type { AuditAgentConfig, AuditAgentResult } from './definitions/audit-agent';
export type {
  AiGovernanceAgentConfig,
  AiGovernanceAgentResult,
} from './definitions/ai-governance-agent';
export type { ToolResult, ToolCallRequest, ToolCallResponse } from './mcp-server';
export type { AgentMessage, SessionSnapshot } from './session/manager';
export type { WorkflowDefinition, WorkflowExecution, WorkflowStep } from './orchestration/engine';
export type { SandboxResult } from './sandbox/runner';
