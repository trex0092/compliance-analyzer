/**
 * Risk Scoring & Monitoring MCP Tools
 *
 * Exposes risk scoring, case decisions, transaction monitoring,
 * and PF screening as callable MCP tools.
 *
 * Regulatory basis: FDL No.10/2025 Art.12-14, Cabinet Res 134/2025 Art.7-10
 */

import type { ToolResult } from '../mcp-server';

import { calcFlagScore, applyContextMultiplier, scoreToLevel } from '../../risk/scoring';
import { decideCase, type DecisionInput, type DecisionOutput } from '../../risk/decisions';
import { RED_FLAGS, type RedFlagDefinition } from '../../risk/redFlags';
import {
  runTransactionMonitoring,
  type TransactionInput,
  type TMAlert,
  type TMConfig,
} from '../../risk/transactionMonitoring';
import { runPFScreening, type PFScreeningInput, type PFAlert } from '../../risk/pfMonitoring';
import { TransactionMonitoringEngine as _TransactionMonitoringEngine } from '../../services/transactionMonitoringEngine';
import { appendToChain, type ChainedAuditEvent } from '../../utils/auditChain';
import { RISK_THRESHOLDS } from '../../domain/constants';

// ---------------------------------------------------------------------------
// Tool: score_risk
// ---------------------------------------------------------------------------

export interface ScoreRiskInput {
  flagCodes: string[];
  context?: {
    highRiskJurisdiction?: boolean;
    pep?: boolean;
    repeatAlert?: boolean;
    cash?: boolean;
    sanctionsProximity?: boolean;
  };
}

export interface ScoreRiskOutput {
  baseScore: number;
  adjustedScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  matchedFlags: Array<{ code: string; title: string; score: number }>;
  thresholds: typeof RISK_THRESHOLDS;
}

export function scoreRisk(input: ScoreRiskInput): ToolResult<ScoreRiskOutput> {
  const matchedFlags = input.flagCodes
    .map((code) => RED_FLAGS.find((f) => f.code === code))
    .filter((f): f is RedFlagDefinition => !!f);

  if (matchedFlags.length === 0 && input.flagCodes.length > 0) {
    return { ok: false, error: `No valid red flag codes found. Example codes: RF001, RF002, ...` };
  }

  const scores = matchedFlags.map((f) => ({
    code: f.code,
    title: f.title,
    score: calcFlagScore(f),
  }));

  const baseScore = scores.reduce((sum, s) => sum + s.score, 0);
  const adjustedScore = applyContextMultiplier(baseScore, input.context ?? {});
  const riskLevel = scoreToLevel(adjustedScore);

  return {
    ok: true,
    data: {
      baseScore,
      adjustedScore,
      riskLevel,
      matchedFlags: scores,
      thresholds: RISK_THRESHOLDS,
    },
  };
}

// ---------------------------------------------------------------------------
// Tool: decide_case
// ---------------------------------------------------------------------------

export function decideCaseTool(input: DecisionInput): ToolResult<DecisionOutput> {
  const output = decideCase(input);
  return { ok: true, data: output };
}

// ---------------------------------------------------------------------------
// Tool: monitor_transaction
// ---------------------------------------------------------------------------

export interface MonitorTransactionInput {
  transaction: TransactionInput;
  config?: TMConfig;
}

export async function monitorTransaction(
  input: MonitorTransactionInput,
  auditChain: ChainedAuditEvent[],
  analyst: string,
): Promise<ToolResult<{ alerts: TMAlert[]; alertCount: number }>> {
  const alerts = runTransactionMonitoring(input.transaction, input.config);

  if (alerts.length > 0) {
    await appendToChain(auditChain, {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      by: analyst,
      action: 'screening-completed',
      note: `TM scan — ${alerts.length} alert(s): ${alerts.map((a) => a.ruleId).join(', ')}`,
    });
  }

  return { ok: true, data: { alerts, alertCount: alerts.length } };
}

// ---------------------------------------------------------------------------
// Tool: screen_pf (Proliferation Financing)
// ---------------------------------------------------------------------------

export async function screenPF(
  input: PFScreeningInput,
  auditChain: ChainedAuditEvent[],
  analyst: string,
): Promise<ToolResult<{ alerts: PFAlert[]; alertCount: number }>> {
  const alerts = runPFScreening(input);

  if (alerts.length > 0) {
    await appendToChain(auditChain, {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      by: analyst,
      action: 'pf-alert-generated',
      note: `PF screening — ${alerts.length} alert(s): ${alerts.map((a) => a.ruleId).join(', ')}`,
    });
  }

  return { ok: true, data: { alerts, alertCount: alerts.length } };
}

// ---------------------------------------------------------------------------
// Tool: get_red_flags
// ---------------------------------------------------------------------------

export function getRedFlags(
  category?: string,
): ToolResult<{ flags: Array<{ code: string; title: string; category: string; likelihood: number; impact: number; autoTriggersEDD: boolean; autoTriggersSTRReview: boolean }> }> {
  let flags = RED_FLAGS;
  if (category) {
    flags = flags.filter((f) => f.category === category);
  }

  return {
    ok: true,
    data: {
      flags: flags.map((f) => ({
        code: f.code,
        title: f.title,
        category: f.category,
        likelihood: f.likelihood,
        impact: f.impact,
        autoTriggersEDD: f.autoTriggersEDD,
        autoTriggersSTRReview: f.autoTriggersSTRReview,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Schema exports for MCP registration
// ---------------------------------------------------------------------------

export const RISK_TOOL_SCHEMAS = [
  {
    name: 'score_risk',
    description:
      'Calculate risk score from red flag codes with context multipliers. Uses likelihood × impact formula per CLAUDE.md. Returns base score, adjusted score, and risk level.',
    inputSchema: {
      type: 'object',
      properties: {
        flagCodes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Red flag codes (e.g. RF001, RF002)',
        },
        context: {
          type: 'object',
          properties: {
            highRiskJurisdiction: { type: 'boolean' },
            pep: { type: 'boolean' },
            repeatAlert: { type: 'boolean' },
            cash: { type: 'boolean' },
            sanctionsProximity: { type: 'boolean' },
          },
        },
      },
      required: ['flagCodes'],
    },
  },
  {
    name: 'decide_case',
    description:
      'Run regulatory decision engine on a compliance case. Returns risk level, mandatory actions, and recommended outcome (continue/edd/reject/suspend/freeze/str-review).',
    inputSchema: {
      type: 'object',
      properties: {
        sanctionMatch: { type: 'boolean' },
        pepMatch: { type: 'boolean' },
        redFlagScores: { type: 'array', items: { type: 'number' } },
        highFlagCount: { type: 'number' },
        criticalFlagCount: { type: 'number' },
        missingCDD: { type: 'boolean' },
        thirdPartyPayment: { type: 'boolean' },
        sourceOfFundsUnverified: { type: 'boolean' },
      },
      required: [
        'sanctionMatch', 'pepMatch', 'redFlagScores', 'highFlagCount',
        'criticalFlagCount', 'missingCDD', 'thirdPartyPayment', 'sourceOfFundsUnverified',
      ],
    },
  },
  {
    name: 'monitor_transaction',
    description:
      'Run transaction against 14 monitoring rules (structuring, profiling, cash threshold AED 55K, precious metals anomalies, etc.). Returns triggered alerts.',
    inputSchema: {
      type: 'object',
      properties: {
        transaction: {
          type: 'object',
          description: 'TransactionInput with amount, currency, customerName, etc.',
        },
        config: {
          type: 'object',
          description: 'Optional TMConfig override for high-risk countries and thresholds',
        },
      },
      required: ['transaction'],
    },
  },
  {
    name: 'screen_pf',
    description:
      'Proliferation Financing screening. Checks entity/goods against PF indicators, dual-use lists, strategic goods controls. Regulatory: Cabinet Res 156/2025.',
    inputSchema: {
      type: 'object',
      properties: {
        entityName: { type: 'string' },
        goodsDescription: { type: 'string' },
        endUseDeclaration: { type: 'string' },
        originCountry: { type: 'string' },
        destinationCountry: { type: 'string' },
        isIndustrialGrade: { type: 'boolean' },
        highRiskJurisdiction: { type: 'boolean' },
        onStrategicGoodsList: { type: 'boolean' },
      },
      required: ['entityName'],
    },
  },
  {
    name: 'get_red_flags',
    description:
      'List available red flag definitions with scores. Optionally filter by category (customer, transaction, sanctions, pf, sourcing, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['customer', 'transaction', 'sanctions', 'pf', 'sourcing', 'sof-sow', 'kyc', 'pep', 'geographic', 'documentation', 'behavioral', 'precious-metals'],
        },
      },
    },
  },
] as const;
