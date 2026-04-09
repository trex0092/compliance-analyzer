/**
 * Compliance MCP Server
 *
 * Central Model Context Protocol server that registers all compliance tools
 * and routes incoming tool calls to the correct handler.
 *
 * Architecture (from Agent SDK diagram):
 *   Tools + Resources / MCP  ←→  Harness  ←→  Session / Sandbox
 *
 * This module is the "Tools + Resources / MCP" box.
 */

import { SCREENING_TOOL_SCHEMAS } from './tools/screening-tools';
import { RISK_TOOL_SCHEMAS } from './tools/risk-tools';
import { FILING_TOOL_SCHEMAS } from './tools/filing-tools';
import { CASE_TOOL_SCHEMAS } from './tools/case-tools';
import { QUANT_TOOL_SCHEMAS } from './tools/quant-analytics-tools';
import { AUTOML_TOOL_SCHEMAS } from './tools/automl-risk-tools';

// Tool handlers
import {
  screenEntity,
  screenMultiModel,
  screenCrossEntity,
  refreshSanctionsLists,
} from './tools/screening-tools';
import {
  scoreRisk,
  decideCaseTool,
  monitorTransaction,
  screenPF,
  getRedFlags,
} from './tools/risk-tools';
import {
  generateGoAMLXml,
  validateGoAMLXml,
  checkFilingDeadline,
  generateKPIReportTool,
  listKPIDefinitions,
} from './tools/filing-tools';
import {
  createCase,
  updateCaseStatus,
  checkApprovals,
  requestApproval,
  scanCDDRenewals,
} from './tools/case-tools';
import {
  runQuantAnalytics,
  detectStructuring,
  calculateBollingerBands,
  runMonteCarloSimulation,
} from './tools/quant-analytics-tools';
import {
  extractFeatures,
  runEnsembleRiskScoring,
  updateModelWeights,
} from './tools/automl-risk-tools';

import type { ChainedAuditEvent } from '../utils/auditChain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResponse {
  toolName: string;
  result: ToolResult;
  executedAt: string;
  durationMs: number;
}

export interface MCPServerContext {
  auditChain: ChainedAuditEvent[];
  analyst: string;
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

const ALL_TOOL_SCHEMAS = [
  ...SCREENING_TOOL_SCHEMAS,
  ...RISK_TOOL_SCHEMAS,
  ...FILING_TOOL_SCHEMAS,
  ...CASE_TOOL_SCHEMAS,
  ...QUANT_TOOL_SCHEMAS,
  ...AUTOML_TOOL_SCHEMAS,
] as const;

export type ToolName = (typeof ALL_TOOL_SCHEMAS)[number]['name'];

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

export class ComplianceMCPServer {
  private context: MCPServerContext;

  constructor(context: MCPServerContext) {
    this.context = context;
  }

  /** List all available tools with schemas (MCP tools/list) */
  listTools() {
    return ALL_TOOL_SCHEMAS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  /** Execute a tool call (MCP tools/call) */
  async callTool(request: ToolCallRequest): Promise<ToolCallResponse> {
    const start = Date.now();
    const { name, arguments: args } = request;

    let result: ToolResult;

    try {
      result = await this.dispatch(name, args);
    } catch (err) {
      result = {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      toolName: name,
      result,
      executedAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
  }

  /** Route tool name to handler */
  private async dispatch(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const { auditChain, analyst, apiKey } = this.context;

    switch (name) {
      // ---- Screening ----
      case 'screen_entity':
        return screenEntity(args as never, auditChain, analyst);
      case 'screen_multi_model':
        if (!apiKey) return { ok: false, error: 'API key required for multi-model screening' };
        return screenMultiModel(args as never, apiKey, auditChain, analyst);
      case 'screen_cross_entity':
        return screenCrossEntity(args as never, auditChain, analyst);
      case 'refresh_sanctions_lists':
        return refreshSanctionsLists((args as { proxyUrl?: string }).proxyUrl);

      // ---- Risk ----
      case 'score_risk':
        return scoreRisk(args as never);
      case 'decide_case':
        return decideCaseTool(args as never);
      case 'monitor_transaction':
        return monitorTransaction(args as never, auditChain, analyst);
      case 'screen_pf':
        return screenPF(args as never, auditChain, analyst);
      case 'get_red_flags':
        return getRedFlags((args as { category?: string }).category);

      // ---- Filing ----
      case 'generate_goaml_xml':
        return generateGoAMLXml(args as never, auditChain, analyst);
      case 'validate_goaml_xml':
        return validateGoAMLXml(args as never);
      case 'check_filing_deadline':
        return checkFilingDeadline(args as never);
      case 'generate_kpi_report':
        return generateKPIReportTool(args as never, auditChain, analyst);
      case 'list_kpi_definitions':
        return listKPIDefinitions((args as { category?: string }).category);

      // ---- Cases ----
      case 'create_case':
        return createCase(args as never, auditChain, analyst);
      case 'update_case_status':
        return updateCaseStatus(args as never, auditChain, analyst);
      case 'check_approvals':
        return checkApprovals(
          (args as { caseObj: never }).caseObj,
          (args as { existingApprovals: never[] }).existingApprovals,
        );
      case 'request_approval':
        return requestApproval(args as never, auditChain, analyst);
      case 'scan_cdd_renewals':
        return scanCDDRenewals(
          (args as { customers: never[] }).customers,
          (args as { existingTasks?: never[] }).existingTasks,
          auditChain,
          analyst,
        );

      // ---- Quant Analytics ----
      case 'analyze_transactions_quant':
        return runQuantAnalytics(
          (args as { entityName: string }).entityName,
          (args as { transactions: never[] }).transactions,
          (args as { historicalAmounts?: number[] }).historicalAmounts,
        );
      case 'detect_structuring':
        return {
          ok: true,
          data: detectStructuring(
            (args as { transactions: never[] }).transactions,
            (args as { threshold?: number }).threshold,
            (args as { timeWindowHours?: number }).timeWindowHours,
          ),
        };
      case 'bollinger_bands_analysis':
        return {
          ok: true,
          data: calculateBollingerBands(
            (args as { amounts: number[] }).amounts,
            (args as { period?: number }).period,
            (args as { stdDevMultiplier?: number }).stdDevMultiplier,
          ),
        };
      case 'monte_carlo_risk':
        return {
          ok: true,
          data: runMonteCarloSimulation(
            (args as { historicalAmounts: number[] }).historicalAmounts,
            (args as { threshold?: number }).threshold,
            (args as { simulations?: number }).simulations,
          ),
        };

      // ---- AutoML Risk ----
      case 'extract_risk_features':
        return {
          ok: true,
          data: extractFeatures(
            (args as { customer: never }).customer,
            (args as { transactions: never[] }).transactions,
            (args as { cases: never[] }).cases,
            (args as { highRiskCountries?: string[] }).highRiskCountries,
          ),
        };
      case 'ensemble_risk_score':
        return {
          ok: true,
          data: runEnsembleRiskScoring(
            (args as { features: never }).features,
            (args as { adaptiveWeights?: Record<string, number> }).adaptiveWeights,
          ),
        };
      case 'update_risk_model_weights':
        return {
          ok: true,
          data: updateModelWeights(
            (args as { feedback: never[] }).feedback,
            (args as { currentWeights: Record<string, number> }).currentWeights,
          ),
        };

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  }

  /** Update context (e.g. when analyst changes) */
  updateContext(partial: Partial<MCPServerContext>) {
    Object.assign(this.context, partial);
  }

  /** Get current audit chain */
  getAuditChain(): ChainedAuditEvent[] {
    return this.context.auditChain;
  }
}
