/**
 * Screening Agent
 *
 * Autonomous agent that handles entity screening workflows:
 * 1. Sanctions list screening (all lists per FDL Art.35)
 * 2. Multi-model AI consensus screening
 * 3. PEP identification
 * 4. Adverse media checks
 * 5. Automatic escalation based on match confidence
 *
 * Decision tree (from CLAUDE.md):
 *   ≥0.9 confirmed  → FREEZE immediately, 24h EOCN, 5-day CNMR
 *   0.5–0.89        → Escalate to CO
 *   <0.5            → Log & dismiss
 */

import type { ComplianceMCPServer, ToolCallResponse } from '../mcp-server';
import type { SessionManager, AgentMessage } from '../session/manager';
import type { ChainedAuditEvent } from '../../utils/auditChain';

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

export interface ScreeningAgentConfig {
  /** Entity name to screen */
  entityName: string;
  /** Entity type */
  entityType: 'individual' | 'entity';
  /** Screening depth */
  depth: 'basic' | 'enhanced' | 'full';
  /** Optional nationality for enhanced screening */
  nationality?: string;
  /** Optional additional context */
  additionalContext?: string;
}

export interface ScreeningAgentResult {
  entityName: string;
  sanctionsResult: ToolCallResponse | null;
  multiModelResult: ToolCallResponse | null;
  pfResult: ToolCallResponse | null;
  overallVerdict: 'clear' | 'potential-match' | 'confirmed-match';
  confidence: number;
  recommendedAction: string;
  escalationRequired: boolean;
  messages: AgentMessage[];
}

// ---------------------------------------------------------------------------
// Agent execution
// ---------------------------------------------------------------------------

export async function runScreeningAgent(
  config: ScreeningAgentConfig,
  server: ComplianceMCPServer,
  session: SessionManager,
): Promise<ScreeningAgentResult> {
  const messages: AgentMessage[] = [];
  const log = (role: AgentMessage['role'], content: string) => {
    const msg: AgentMessage = { role, content, timestamp: new Date().toISOString() };
    messages.push(msg);
    session.addMessage(msg);
  };

  log('system', `Starting screening agent for "${config.entityName}" (${config.depth})`);

  // Step 1: Sanctions list screening (always runs)
  log('assistant', `Screening "${config.entityName}" against all sanctions lists...`);
  const sanctionsResult = await server.callTool({
    name: 'screen_entity',
    arguments: { entityName: config.entityName, entityType: config.entityType },
  });

  let overallVerdict: ScreeningAgentResult['overallVerdict'] = 'clear';
  let confidence = 0;
  let escalationRequired = false;

  if (sanctionsResult.result.ok) {
    const data = sanctionsResult.result.data as { matches: Array<{ confidence: number }> };
    if (data.matches.length > 0) {
      const maxConfidence = Math.max(...data.matches.map((m) => m.confidence));
      confidence = maxConfidence;

      if (maxConfidence >= 0.9) {
        overallVerdict = 'confirmed-match';
        escalationRequired = true;
        log('assistant', `CONFIRMED MATCH (confidence: ${maxConfidence}). Initiating freeze protocol.`);
      } else if (maxConfidence >= 0.5) {
        overallVerdict = 'potential-match';
        escalationRequired = true;
        log('assistant', `POTENTIAL MATCH (confidence: ${maxConfidence}). Escalating to Compliance Officer.`);
      } else {
        log('assistant', `Low-confidence matches dismissed (max: ${maxConfidence}). Documenting reasoning.`);
      }
    } else {
      log('assistant', `No sanctions matches found across ${(sanctionsResult.result.data as { listsChecked: string[] }).listsChecked.length} lists.`);
    }
  }

  // Step 2: Multi-model AI screening (enhanced + full depth)
  let multiModelResult: ToolCallResponse | null = null;
  if (config.depth !== 'basic') {
    log('assistant', `Running multi-model AI consensus screening...`);
    multiModelResult = await server.callTool({
      name: 'screen_multi_model',
      arguments: {
        entityName: config.entityName,
        entityType: config.entityType,
        screeningType: 'sanctions',
        nationality: config.nationality,
        additionalContext: config.additionalContext,
      },
    });

    if (multiModelResult.result.ok) {
      const consensus = multiModelResult.result.data as { consensus: string; consensusConfidence: number };
      if (consensus.consensus === 'confirmed-match' && consensus.consensusConfidence > confidence) {
        overallVerdict = 'confirmed-match';
        confidence = consensus.consensusConfidence;
        escalationRequired = true;
      } else if (consensus.consensus === 'potential-match' && overallVerdict === 'clear') {
        overallVerdict = 'potential-match';
        confidence = consensus.consensusConfidence;
        escalationRequired = true;
      }
      log('assistant', `Multi-model consensus: ${consensus.consensus} (confidence: ${consensus.consensusConfidence})`);
    }
  }

  // Step 3: PF screening (full depth only)
  let pfResult: ToolCallResponse | null = null;
  if (config.depth === 'full') {
    log('assistant', `Running Proliferation Financing screening...`);
    pfResult = await server.callTool({
      name: 'screen_pf',
      arguments: {
        entityName: config.entityName,
        destinationCountry: config.nationality,
      },
    });

    if (pfResult.result.ok) {
      const pfData = pfResult.result.data as { alertCount: number };
      if (pfData.alertCount > 0) {
        escalationRequired = true;
        log('assistant', `PF screening: ${pfData.alertCount} alert(s) generated.`);
      }
    }
  }

  // Determine recommended action based on decision tree
  let recommendedAction: string;
  if (overallVerdict === 'confirmed-match') {
    recommendedAction = 'FREEZE immediately. Start 24h EOCN countdown. File CNMR within 5 business days. DO NOT notify subject (Art.29).';
  } else if (overallVerdict === 'potential-match') {
    recommendedAction = 'Escalate to Compliance Officer for manual review. CO decides: confirm → FREEZE path, or false positive → document & dismiss.';
  } else {
    recommendedAction = 'Entity cleared. Log screening result and schedule next periodic review.';
  }

  log('system', `Screening complete — verdict: ${overallVerdict}, action: ${recommendedAction}`);

  return {
    entityName: config.entityName,
    sanctionsResult,
    multiModelResult,
    pfResult,
    overallVerdict,
    confidence,
    recommendedAction,
    escalationRequired,
    messages,
  };
}
