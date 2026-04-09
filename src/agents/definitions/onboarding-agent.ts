/**
 * Onboarding Agent
 *
 * Autonomous agent for customer onboarding workflow:
 * 1. Screen customer (sanctions + PEP + adverse media)
 * 2. Score risk → determine CDD tier
 * 3. If EDD → request senior management approval
 * 4. Create compliance case
 * 5. Set monitoring schedule + CDD renewal dates
 *
 * Decision tree (from CLAUDE.md):
 *   Score < 6    → SDD → standard CDD review at 12 months
 *   Score 6–15   → CDD → review at 6 months
 *   Score >= 16  → EDD → review at 3 months + Senior Management approval
 *   PEP detected → EDD + Board approval
 *   Sanctions    → STOP → run incident agent
 */

import type { ComplianceMCPServer, ToolCallResponse } from '../mcp-server';
import type { SessionManager, AgentMessage } from '../session/manager';
import type { ComplianceCase } from '../../domain/cases';
import type { CustomerProfile } from '../../domain/customers';

import { runScreeningAgent, type ScreeningAgentResult } from './screening-agent';
import {
  CDD_REVIEW_HIGH_RISK_MONTHS,
  CDD_REVIEW_MEDIUM_RISK_MONTHS,
  CDD_REVIEW_LOW_RISK_MONTHS,
} from '../config';

// ---------------------------------------------------------------------------
// Agent definition
// ---------------------------------------------------------------------------

export interface OnboardingAgentConfig {
  customer: CustomerProfile;
  /** Red flag codes detected during initial assessment */
  redFlagCodes?: string[];
  /** Context multipliers */
  context?: {
    highRiskJurisdiction?: boolean;
    pep?: boolean;
    cash?: boolean;
  };
}

export type CDDTier = 'SDD' | 'CDD' | 'EDD';

export interface OnboardingAgentResult {
  customer: CustomerProfile;
  screeningResult: ScreeningAgentResult;
  riskScoreResult: ToolCallResponse | null;
  cddTier: CDDTier;
  reviewFrequencyMonths: number;
  nextReviewDate: string;
  complianceCase: ComplianceCase | null;
  approvalRequired: boolean;
  approvalGates: string[];
  blocked: boolean;
  blockReason?: string;
  messages: AgentMessage[];
}

// ---------------------------------------------------------------------------
// Agent execution
// ---------------------------------------------------------------------------

export async function runOnboardingAgent(
  config: OnboardingAgentConfig,
  server: ComplianceMCPServer,
  session: SessionManager,
): Promise<OnboardingAgentResult> {
  const messages: AgentMessage[] = [];
  const log = (role: AgentMessage['role'], content: string) => {
    const msg: AgentMessage = { role, content, timestamp: new Date().toISOString() };
    messages.push(msg);
    session.addMessage(msg);
  };

  log('system', `Starting onboarding agent for "${config.customer.legalName}"`);

  // Step 1: Screen customer
  log('assistant', `Step 1/5: Screening "${config.customer.legalName}"...`);
  const screeningResult = await runScreeningAgent(
    {
      entityName: config.customer.legalName,
      entityType: 'entity',
      depth: 'enhanced',
      nationality: config.customer.countryOfRegistration,
    },
    server,
    session,
  );

  // Check for sanctions block
  if (screeningResult.overallVerdict === 'confirmed-match') {
    log('assistant', `BLOCKED: Confirmed sanctions match. Cannot proceed with onboarding. Run incident agent.`);
    return {
      customer: config.customer,
      screeningResult,
      riskScoreResult: null,
      cddTier: 'EDD',
      reviewFrequencyMonths: 0,
      nextReviewDate: '',
      complianceCase: null,
      approvalRequired: false,
      approvalGates: [],
      blocked: true,
      blockReason: 'Confirmed sanctions match — run /incident [customer] sanctions-match',
      messages,
    };
  }

  // Step 2: Score risk
  log('assistant', `Step 2/5: Calculating risk score...`);
  const flagCodes = config.redFlagCodes ?? [];
  const riskScoreResult = await server.callTool({
    name: 'score_risk',
    arguments: {
      flagCodes,
      context: {
        ...config.context,
        pep: config.context?.pep || config.customer.pepStatus === 'match',
        sanctionsProximity: screeningResult.overallVerdict === 'potential-match',
      },
    },
  });

  let adjustedScore = 0;
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (riskScoreResult.result.ok) {
    const data = riskScoreResult.result.data as { adjustedScore: number; riskLevel: string };
    adjustedScore = data.adjustedScore;
    riskLevel = data.riskLevel as typeof riskLevel;
  }

  // Step 3: Determine CDD tier
  let cddTier: CDDTier;
  let reviewFrequencyMonths: number;

  if (adjustedScore >= 16 || config.customer.pepStatus === 'match') {
    cddTier = 'EDD';
    reviewFrequencyMonths = CDD_REVIEW_HIGH_RISK_MONTHS;
  } else if (adjustedScore >= 6) {
    cddTier = 'CDD';
    reviewFrequencyMonths = CDD_REVIEW_MEDIUM_RISK_MONTHS;
  } else {
    cddTier = 'SDD';
    reviewFrequencyMonths = CDD_REVIEW_LOW_RISK_MONTHS;
  }

  const nextReviewDate = new Date();
  nextReviewDate.setMonth(nextReviewDate.getMonth() + reviewFrequencyMonths);

  log('assistant', `Step 3/5: CDD tier determined — ${cddTier} (score: ${adjustedScore}, review: ${reviewFrequencyMonths}mo)`);

  // Step 4: Create compliance case
  log('assistant', `Step 4/5: Creating compliance case...`);
  const caseResult = await server.callTool({
    name: 'create_case',
    arguments: {
      entityId: config.customer.id,
      caseType: 'onboarding',
      sourceModule: 'onboarding',
      riskScore: adjustedScore,
      riskLevel,
      redFlags: flagCodes,
      findings: [
        `Screening: ${screeningResult.overallVerdict}`,
        `CDD Tier: ${cddTier}`,
        `PEP Status: ${config.customer.pepStatus}`,
      ],
      narrative: `Customer onboarding for ${config.customer.legalName}. Risk score: ${adjustedScore} (${riskLevel}). CDD tier: ${cddTier}. Next review: ${nextReviewDate.toISOString().slice(0, 10)}.`,
      recommendation: cddTier === 'EDD' ? 'edd' : 'continue',
      linkedCustomerId: config.customer.id,
    },
  });

  const complianceCase = caseResult.result.ok
    ? (caseResult.result.data as ComplianceCase)
    : null;

  // Step 5: Check approval requirements
  let approvalRequired = false;
  const approvalGates: string[] = [];

  if (cddTier === 'EDD') {
    approvalRequired = true;
    approvalGates.push('high-risk-onboarding');
    log('assistant', `Step 5/5: EDD requires Senior Management approval (Art.14).`);
  }
  if (config.customer.pepStatus === 'match') {
    approvalRequired = true;
    if (!approvalGates.includes('pep-onboarding')) {
      approvalGates.push('pep-onboarding');
    }
    log('assistant', `PEP detected — Board approval required.`);
  }

  // Request approvals if needed
  if (approvalRequired && complianceCase) {
    for (const gate of approvalGates) {
      await server.callTool({
        name: 'request_approval',
        arguments: { caseId: complianceCase.id, gate },
      });
    }
  }

  if (!approvalRequired) {
    log('assistant', `Step 5/5: No additional approvals required. Onboarding can proceed.`);
  }

  log('system', `Onboarding complete — tier: ${cddTier}, next review: ${nextReviewDate.toISOString().slice(0, 10)}`);

  return {
    customer: config.customer,
    screeningResult,
    riskScoreResult,
    cddTier,
    reviewFrequencyMonths,
    nextReviewDate: nextReviewDate.toISOString().slice(0, 10),
    complianceCase,
    approvalRequired,
    approvalGates,
    blocked: false,
    messages,
  };
}
