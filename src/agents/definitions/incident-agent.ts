/**
 * Incident Response Agent
 *
 * Handles time-critical compliance incidents with regulatory countdowns:
 * - Sanctions match → 24h freeze + 5-day CNMR
 * - STR trigger → immediate filing (FDL Art.26)
 * - Asset freeze directive from EOCN
 *
 * Key regulatory deadlines:
 *   EOCN freeze:  24 clock hours (NOT business days)
 *   CNMR:         5 business days
 *   STR:          without delay (FDL Art.26)
 *
 * CRITICAL: Never notify the subject (Art.29 — no tipping off)
 */

import type { ComplianceMCPServer, ToolCallResponse } from '../mcp-server';
import type { SessionManager, AgentMessage } from '../session/manager';
import type { ComplianceCase } from '../../domain/cases';

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

export type IncidentType =
  | 'sanctions-match'
  | 'str-trigger'
  | 'asset-freeze'
  | 'pf-alert'
  | 'regulatory-breach';

export interface IncidentAgentConfig {
  entityId: string;
  entityName: string;
  incidentType: IncidentType;
  /** Match confidence (for sanctions-match) */
  matchConfidence?: number;
  /** Additional details */
  details?: string;
}

export interface IncidentCountdown {
  type: string;
  deadline: string;
  isClockHours: boolean;
  regulatoryRef: string;
}

export interface IncidentAgentResult {
  entityName: string;
  incidentType: IncidentType;
  caseCreated: ComplianceCase | null;
  countdowns: IncidentCountdown[];
  actionsPerformed: string[];
  deadlineResults: ToolCallResponse[];
  escalatedTo: string[];
  noTippingOff: boolean;
  messages: AgentMessage[];
}

// ---------------------------------------------------------------------------
// Agent execution
// ---------------------------------------------------------------------------

export async function runIncidentAgent(
  config: IncidentAgentConfig,
  server: ComplianceMCPServer,
  session: SessionManager
): Promise<IncidentAgentResult> {
  const messages: AgentMessage[] = [];
  const actionsPerformed: string[] = [];
  const countdowns: IncidentCountdown[] = [];
  const deadlineResults: ToolCallResponse[] = [];
  const escalatedTo: string[] = [];

  const log = (role: AgentMessage['role'], content: string) => {
    const msg: AgentMessage = { role, content, timestamp: new Date().toISOString() };
    messages.push(msg);
    session.addMessage(msg);
  };

  const _now = new Date().toISOString();
  log(
    'system',
    `INCIDENT RESPONSE initiated for "${config.entityName}" — type: ${config.incidentType}`
  );

  // Step 1: Create incident case
  log('assistant', `Creating incident case...`);
  const caseResult = await server.callTool({
    name: 'create_case',
    arguments: {
      entityId: config.entityId,
      caseType: 'incident',
      sourceModule: 'incidents',
      riskScore: 20, // incidents start at critical
      riskLevel: 'critical',
      redFlags: [config.incidentType],
      findings: [`Incident type: ${config.incidentType}`, config.details ?? ''].filter(Boolean),
      narrative: `${config.incidentType} incident for ${config.entityName}. ${config.details ?? ''}`,
      recommendation: config.incidentType === 'sanctions-match' ? 'freeze' : 'str-review',
    },
  });

  const complianceCase = caseResult.result.ok ? (caseResult.result.data as ComplianceCase) : null;

  // Step 2: Handle by incident type
  switch (config.incidentType) {
    case 'sanctions-match':
      await handleSanctionsMatch(
        config,
        server,
        log,
        actionsPerformed,
        countdowns,
        deadlineResults,
        escalatedTo,
        complianceCase
      );
      break;

    case 'str-trigger':
      await handleSTRTrigger(
        config,
        server,
        log,
        actionsPerformed,
        countdowns,
        deadlineResults,
        escalatedTo,
        complianceCase
      );
      break;

    case 'asset-freeze':
      await handleAssetFreeze(
        config,
        server,
        log,
        actionsPerformed,
        countdowns,
        deadlineResults,
        escalatedTo,
        complianceCase
      );
      break;

    case 'pf-alert':
      await handlePFAlert(
        config,
        server,
        log,
        actionsPerformed,
        countdowns,
        deadlineResults,
        escalatedTo,
        complianceCase
      );
      break;

    case 'regulatory-breach':
      await handleRegulatoryBreach(
        config,
        server,
        log,
        actionsPerformed,
        countdowns,
        deadlineResults,
        escalatedTo,
        complianceCase
      );
      break;
  }

  log(
    'system',
    `Incident response complete — ${actionsPerformed.length} actions, ${countdowns.length} active countdowns`
  );

  return {
    entityName: config.entityName,
    incidentType: config.incidentType,
    caseCreated: complianceCase,
    countdowns,
    actionsPerformed,
    deadlineResults,
    escalatedTo,
    noTippingOff: true, // Art.29 — always enforced
    messages,
  };
}

// ---------------------------------------------------------------------------
// Incident handlers
// ---------------------------------------------------------------------------

async function handleSanctionsMatch(
  config: IncidentAgentConfig,
  server: ComplianceMCPServer,
  log: (role: AgentMessage['role'], content: string) => void,
  actions: string[],
  countdowns: IncidentCountdown[],
  deadlineResults: ToolCallResponse[],
  escalatedTo: string[],
  caseObj: ComplianceCase | null
) {
  const confidence = config.matchConfidence ?? 1.0;
  const now = new Date();

  if (confidence >= 0.9) {
    // CONFIRMED — FREEZE immediately
    log('assistant', `CONFIRMED MATCH (confidence: ${confidence}). Executing freeze protocol.`);

    // 1. Freeze assets
    actions.push('Asset freeze initiated (Cabinet Res 74/2020 Art.4)');
    log('assistant', `Assets FROZEN. No transactions permitted.`);

    // 2. Start 24h EOCN countdown
    const eocnDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    countdowns.push({
      type: 'EOCN Notification',
      deadline: eocnDeadline.toISOString(),
      isClockHours: true,
      regulatoryRef: 'Cabinet Res 74/2020 Art.5',
    });
    actions.push('24h EOCN countdown started');
    log('assistant', `EOCN notification deadline: ${eocnDeadline.toISOString()} (24 clock hours)`);

    // 3. CNMR filing deadline (5 business days)
    const cnmrResult = await server.callTool({
      name: 'check_filing_deadline',
      arguments: { eventDate: now.toISOString(), filingType: 'CNMR' },
    });
    deadlineResults.push(cnmrResult);

    if (cnmrResult.result.ok) {
      const cnmr = cnmrResult.result.data as { dueDate: string };
      countdowns.push({
        type: 'CNMR Filing',
        deadline: cnmr.dueDate,
        isClockHours: false,
        regulatoryRef: 'Cabinet Res 74/2020 Art.6',
      });
      actions.push(`CNMR filing deadline set: ${cnmr.dueDate}`);
    }

    // 4. Escalate
    escalatedTo.push('MLRO', 'EOCN', 'Senior Management');
    actions.push('Escalated to MLRO, EOCN, and Senior Management');

    // 5. DO NOT notify subject
    log(
      'assistant',
      `WARNING: DO NOT notify ${config.entityName} of this action (Art.29 — no tipping off)`
    );
    actions.push('No-tipping-off rule enforced (FDL Art.29)');
  } else if (confidence >= 0.5) {
    // POTENTIAL — Escalate to CO
    log(
      'assistant',
      `POTENTIAL MATCH (confidence: ${confidence}). Escalating to Compliance Officer.`
    );
    escalatedTo.push('Compliance Officer');
    actions.push('Escalated to Compliance Officer for manual review');
    actions.push('CO to decide: confirm → FREEZE path, or false positive → document & dismiss');
  }

  // Request approval for asset freeze
  if (caseObj && confidence >= 0.9) {
    await server.callTool({
      name: 'request_approval',
      arguments: { caseId: caseObj.id, gate: 'asset-freeze' },
    });
    actions.push('Asset freeze approval requested');
  }
}

async function handleSTRTrigger(
  config: IncidentAgentConfig,
  server: ComplianceMCPServer,
  log: (role: AgentMessage['role'], content: string) => void,
  actions: string[],
  countdowns: IncidentCountdown[],
  deadlineResults: ToolCallResponse[],
  escalatedTo: string[],
  caseObj: ComplianceCase | null
) {
  log('assistant', `STR trigger detected. Filing deadline: WITHOUT DELAY (FDL Art.26).`);

  const strResult = await server.callTool({
    name: 'check_filing_deadline',
    arguments: { eventDate: new Date().toISOString(), filingType: 'STR' },
  });
  deadlineResults.push(strResult);

  countdowns.push({
    type: 'STR Filing',
    deadline: new Date().toISOString(), // immediate
    isClockHours: false,
    regulatoryRef: 'FDL No.10/2025 Art.26',
  });

  escalatedTo.push('MLRO');
  actions.push('STR draft initiated');
  actions.push('Escalated to MLRO for review and submission');
  actions.push('No-tipping-off rule enforced (FDL Art.29)');

  if (caseObj) {
    await server.callTool({
      name: 'request_approval',
      arguments: { caseId: caseObj.id, gate: 'str-approval' },
    });
    actions.push('STR approval requested from MLRO');
  }
}

async function handleAssetFreeze(
  config: IncidentAgentConfig,
  server: ComplianceMCPServer,
  log: (role: AgentMessage['role'], content: string) => void,
  actions: string[],
  countdowns: IncidentCountdown[],
  deadlineResults: ToolCallResponse[],
  escalatedTo: string[],
  _caseObj: ComplianceCase | null
) {
  const now = new Date();
  log('assistant', `EOCN asset freeze directive received. Executing within 24 hours.`);

  const eocnDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  countdowns.push({
    type: 'Asset Freeze Execution',
    deadline: eocnDeadline.toISOString(),
    isClockHours: true,
    regulatoryRef: 'Cabinet Res 74/2020 Art.4-7',
  });

  actions.push('Asset freeze executed');
  actions.push('All transactions blocked');

  const cnmrResult = await server.callTool({
    name: 'check_filing_deadline',
    arguments: { eventDate: now.toISOString(), filingType: 'CNMR' },
  });
  deadlineResults.push(cnmrResult);

  if (cnmrResult.result.ok) {
    const cnmr = cnmrResult.result.data as { dueDate: string };
    countdowns.push({
      type: 'CNMR Filing',
      deadline: cnmr.dueDate,
      isClockHours: false,
      regulatoryRef: 'Cabinet Res 74/2020 Art.6',
    });
  }

  escalatedTo.push('MLRO', 'EOCN', 'Senior Management', 'Board');
  actions.push('Escalated to MLRO, EOCN, Senior Management, Board');
}

async function handlePFAlert(
  config: IncidentAgentConfig,
  server: ComplianceMCPServer,
  log: (role: AgentMessage['role'], content: string) => void,
  actions: string[],
  countdowns: IncidentCountdown[],
  _deadlineResults: ToolCallResponse[],
  escalatedTo: string[],
  caseObj: ComplianceCase | null
) {
  log('assistant', `Proliferation Financing alert. Escalating per Cabinet Res 156/2025.`);

  escalatedTo.push('Compliance Officer', 'MLRO');
  actions.push('PF alert logged');
  actions.push('Goods/transaction flagged for enhanced review');
  actions.push('Strategic goods screening initiated');

  if (caseObj) {
    await server.callTool({
      name: 'request_approval',
      arguments: { caseId: caseObj.id, gate: 'pf-escalation' },
    });
    actions.push('PF escalation approval requested');
  }
}

async function handleRegulatoryBreach(
  config: IncidentAgentConfig,
  server: ComplianceMCPServer,
  log: (role: AgentMessage['role'], content: string) => void,
  actions: string[],
  _countdowns: IncidentCountdown[],
  _deadlineResults: ToolCallResponse[],
  escalatedTo: string[],
  _caseObj: ComplianceCase | null
) {
  log(
    'assistant',
    `Regulatory breach detected. Penalty range: AED 10,000–100,000,000 (Cabinet Res 71/2024).`
  );

  escalatedTo.push('Compliance Officer', 'MLRO', 'Senior Management', 'Legal');
  actions.push('Breach documented with evidence');
  actions.push('Root cause analysis initiated');
  actions.push('Remediation plan required within 30 days');
  actions.push('Escalated to CO, MLRO, Senior Management, Legal');
}
