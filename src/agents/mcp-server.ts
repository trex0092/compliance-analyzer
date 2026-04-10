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
import { NETWORK_TOOL_SCHEMAS } from './tools/network-analysis-tools';
import { ADVERSARIAL_TOOL_SCHEMAS } from './tools/adversarial-detection-tools';
import { PREDICTIVE_TOOL_SCHEMAS } from './tools/predictive-risk-tools';
import { EXPLAINABLE_TOOL_SCHEMAS } from './tools/explainable-ai-tools';
import { STREAMING_TOOL_SCHEMAS } from './tools/streaming-pipeline-tools';
import { EVIDENCE_VAULT_TOOL_SCHEMAS } from './tools/evidence-vault-tools';
import { NL_COMMAND_TOOL_SCHEMAS } from './tools/nl-command-tools';
import { COLLABORATION_TOOL_SCHEMAS } from './tools/multi-agent-protocol-tools';
import { KNOWLEDGE_GRAPH_TOOL_SCHEMAS } from './tools/knowledge-graph-tools';
import { GEO_TOOL_SCHEMAS } from './tools/geospatial-risk-tools';
import { EVASION_TOOL_SCHEMAS } from './tools/sanctions-evasion-tools';
import { DOCUMENT_TOOL_SCHEMAS } from './tools/document-intelligence-tools';
import { RADAR_TOOL_SCHEMAS } from './tools/regulatory-radar-tools';
import { SWIFT_TOOL_SCHEMAS } from './tools/swift-wire-tools';
import { SUPPLY_CHAIN_TOOL_SCHEMAS } from './tools/supply-chain-tools';
import { INSIDER_THREAT_TOOL_SCHEMAS } from './tools/insider-threat-tools';
import { CRYPTO_TOOL_SCHEMAS } from './tools/crypto-asset-tools';
import { WHISTLEBLOWER_TOOL_SCHEMAS } from './tools/whistleblower-tools';
import { MOE_REPORT_TOOL_SCHEMAS } from './tools/moe-report-tools';

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
import { runNetworkAnalysis } from './tools/network-analysis-tools';
import { runAdversarialDetection } from './tools/adversarial-detection-tools';
import { runPredictiveRiskAnalysis } from './tools/predictive-risk-tools';
import { explainScreeningDecision, explainRiskDecision } from './tools/explainable-ai-tools';
import { parseCommand } from './tools/nl-command-tools';
import { runGeospatialAnalysis, getJurisdictionProfile } from './tools/geospatial-risk-tools';
import { matchNameAdvanced } from './tools/sanctions-evasion-tools';
import { analyzeDocument } from './tools/document-intelligence-tools';
import { assessRegulatoryChange } from './tools/regulatory-radar-tools';
import { parseSwiftMT103, analyzeWireChain } from './tools/swift-wire-tools';
import { verifySupplyChain, checkLBMACompliance } from './tools/supply-chain-tools';
import { analyzeUserBehavior } from './tools/insider-threat-tools';
import { analyzeBlockchainActivity } from './tools/crypto-asset-tools';
import { submitAnonymousTip } from './tools/whistleblower-tools';
import { generateMoEReport } from './tools/moe-report-tools';

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
  ...NETWORK_TOOL_SCHEMAS,
  ...ADVERSARIAL_TOOL_SCHEMAS,
  ...PREDICTIVE_TOOL_SCHEMAS,
  ...EXPLAINABLE_TOOL_SCHEMAS,
  ...STREAMING_TOOL_SCHEMAS,
  ...EVIDENCE_VAULT_TOOL_SCHEMAS,
  ...NL_COMMAND_TOOL_SCHEMAS,
  ...COLLABORATION_TOOL_SCHEMAS,
  ...KNOWLEDGE_GRAPH_TOOL_SCHEMAS,
  ...GEO_TOOL_SCHEMAS,
  ...EVASION_TOOL_SCHEMAS,
  ...DOCUMENT_TOOL_SCHEMAS,
  ...RADAR_TOOL_SCHEMAS,
  ...SWIFT_TOOL_SCHEMAS,
  ...SUPPLY_CHAIN_TOOL_SCHEMAS,
  ...INSIDER_THREAT_TOOL_SCHEMAS,
  ...CRYPTO_TOOL_SCHEMAS,
  ...WHISTLEBLOWER_TOOL_SCHEMAS,
  ...MOE_REPORT_TOOL_SCHEMAS,
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

      // ---- Advanced Engines ----
      case 'analyze_entity_network':
        return runNetworkAnalysis((args as { graph: never }).graph);
      case 'detect_adversarial_patterns':
        return runAdversarialDetection((args as { transactions: never[] }).transactions);
      case 'predict_risk_trajectory':
        return runPredictiveRiskAnalysis(
          (args as { entityName: string }).entityName,
          (args as { data: never[] }).data,
          (args as { forecastDays?: number }).forecastDays,
        );
      case 'explain_screening_decision':
        return explainScreeningDecision(args as never);
      case 'explain_risk_decision':
        return explainRiskDecision(args as never);
      case 'parse_nl_command':
        return parseCommand((args as { command: string }).command);

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

      // ---- Geospatial ----
      case 'analyze_geospatial_risk':
        return runGeospatialAnalysis(
          (args as { routes: never[] }).routes,
          (args as { entities?: never[] }).entities,
        );
      case 'get_jurisdiction_profile':
        return { ok: true, data: getJurisdictionProfile((args as { countryCode: string }).countryCode) };

      // ---- Sanctions Evasion ----
      case 'detect_sanctions_evasion':
        return matchNameAdvanced(
          (args as { queryName: string }).queryName,
          (args as { targetNames: string[] }).targetNames,
        );

      // ---- Document Intelligence ----
      case 'analyze_document':
        return analyzeDocument(
          (args as { text: string }).text,
          (args as { documentType?: 'invoice' | 'kyc' | 'trade' | 'narrative' }).documentType,
        );

      // ---- Regulatory Radar ----
      case 'assess_regulatory_change':
        return { ok: true, data: assessRegulatoryChange((args as { change: never }).change) };

      // ---- SWIFT Wire ----
      case 'parse_swift_mt103':
        return parseSwiftMT103(args as { rawMessage: string });
      case 'analyze_wire_chain':
        return analyzeWireChain(args as never);

      // ---- Supply Chain ----
      case 'verify_supply_chain':
        return verifySupplyChain(args as never);
      case 'check_lbma_compliance':
        return checkLBMACompliance(args as never);

      // ---- Insider Threat ----
      case 'analyze_user_behavior':
        return analyzeUserBehavior(args as never);

      // ---- Crypto/VA ----
      case 'analyze_crypto_activity':
        return analyzeBlockchainActivity(args as never);

      // ---- Whistleblower ----
      case 'submit_anonymous_tip':
        return submitAnonymousTip(args as never);

      // ---- MoE Reports ----
      case 'generate_moe_report':
        return generateMoEReport(args as never);

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
