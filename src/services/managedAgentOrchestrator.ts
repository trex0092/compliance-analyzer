/**
 * Claude Managed Agents Orchestrator for Compliance Analyzer
 *
 * Implements the Managed Agents architecture (Harness → Session + Sandbox +
 * Orchestration + Tools/MCP) for autonomous compliance workflows.
 *
 * Architecture (as shown in Anthropic's Managed Agents launch):
 *
 *   Tools/MCP ──┐
 *   Session  ←──┤── Harness (Claude) ──→ Sandbox
 *   Orchestration←─┘
 *
 * Each compliance workflow is a MANAGED AGENT with:
 *   - Task definition (what to do)
 *   - Tool access (sanctions lists, goAML, Asana, MoE portal)
 *   - Guardrails (no tipping off, four-eyes enforced, audit trail mandatory)
 *   - Recovery (retry + escalation on failure)
 *
 * Supported managed workflows:
 *   1. SCREENING_AGENT       — full sanctions + CDD + ESG screening
 *   2. STR_FILING_AGENT      — classify + draft + submit STR via goAML
 *   3. EDD_AGENT             — orchestrate EDD workflow + senior approval
 *   4. FREEZE_AGENT          — execute asset freeze + EOCN countdown
 *   5. KYC_RENEWAL_AGENT     — periodic CDD/EDD renewal pipeline
 *   6. ESG_AUDIT_AGENT       — full ESG scoring + TCFD + SDG + LBMA
 *   7. ASANA_SYNC_AGENT      — sync all compliance tasks to Asana
 *   8. REPORT_AGENT          — generate comprehensive compliance report
 *
 * Regulatory: FDL No.10/2025 Art.20-21 (CO duties), Art.24 (audit trail),
 *             Art.29 (no tipping off), Cabinet Res 74/2020 Art.4 (24h freeze),
 *             Cabinet Res 134/2025 Art.19 (internal review before action),
 *             NIST AI RMF GV-1.6 (AI governance).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ManagedAgentType =
  | 'SCREENING_AGENT'
  | 'STR_FILING_AGENT'
  | 'EDD_AGENT'
  | 'FREEZE_AGENT'
  | 'KYC_RENEWAL_AGENT'
  | 'ESG_AUDIT_AGENT'
  | 'ASANA_SYNC_AGENT'
  | 'REPORT_AGENT';

export type AgentStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'    // four-eyes gate
  | 'completed'
  | 'failed'
  | 'escalated';

export type GuardrailType =
  | 'no_tipping_off'        // FDL Art.29
  | 'four_eyes_required'    // high-stakes decisions
  | 'audit_trail_mandatory' // FDL Art.24
  | 'human_in_the_loop'     // freeze + STR verdicts
  | 'rate_limit'            // 100 req/15min
  | 'sanctions_list_check'; // all 6 lists mandatory

export interface AgentGuardrail {
  type: GuardrailType;
  enforcedAt: 'pre_tool' | 'post_tool' | 'pre_handoff' | 'always';
  blockOnViolation: boolean;
  regulatoryRef: string;
}

export interface ManagedAgentTask {
  taskId: string;
  agentType: ManagedAgentType;
  entityId: string;
  entityName: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  triggeredBy: string;         // verdict/event that spawned this agent
  triggeredAt: string;         // ISO datetime
  deadline?: string;           // ISO datetime (24h for freeze, 10bd for STR)
  guardrails: AgentGuardrail[];
  toolsAllowed: string[];
  sessionId?: string;
  sandboxIsolated: boolean;    // true for STR/freeze — prevents data leakage
  status: AgentStatus;
  result?: AgentResult;
}

export interface AgentResult {
  completedAt: string;
  status: AgentStatus;
  summary: string;
  actionsPerformed: string[];
  filingRefs?: string[];       // goAML reference numbers
  asanaTaskGids?: string[];
  regulatoryRefs: string[];
  requiresFollowUp: boolean;
  followUpBy?: string;
}

export interface OrchestratorSession {
  sessionId: string;
  entityId: string;
  startedAt: string;
  activeAgents: ManagedAgentTask[];
  completedAgents: ManagedAgentTask[];
  failedAgents: ManagedAgentTask[];
  overallStatus: AgentStatus;
  auditLog: string[];
}

// ─── Guardrail Definitions ────────────────────────────────────────────────────

const STANDARD_GUARDRAILS: AgentGuardrail[] = [
  {
    type: 'no_tipping_off',
    enforcedAt: 'always',
    blockOnViolation: true,
    regulatoryRef: 'FDL No.10/2025 Art.29 — tipping off is a criminal offence',
  },
  {
    type: 'audit_trail_mandatory',
    enforcedAt: 'post_tool',
    blockOnViolation: true,
    regulatoryRef: 'FDL No.10/2025 Art.24 — all actions must be logged for 10 years',
  },
  {
    type: 'rate_limit',
    enforcedAt: 'pre_tool',
    blockOnViolation: true,
    regulatoryRef: 'CLAUDE.md Seguridad §1 — 100 req/15min',
  },
  {
    type: 'sanctions_list_check',
    enforcedAt: 'pre_handoff',
    blockOnViolation: true,
    regulatoryRef: 'Cabinet Res 74/2020 Art.3 — all 6 lists mandatory',
  },
];

const HIGH_STAKES_GUARDRAILS: AgentGuardrail[] = [
  ...STANDARD_GUARDRAILS,
  {
    type: 'four_eyes_required',
    enforcedAt: 'pre_handoff',
    blockOnViolation: true,
    regulatoryRef: 'FDL No.10/2025 Art.20-21; Cabinet Res 74/2020 Art.4',
  },
  {
    type: 'human_in_the_loop',
    enforcedAt: 'pre_handoff',
    blockOnViolation: true,
    regulatoryRef: 'Cabinet Res 134/2025 Art.19 — internal review before action',
  },
];

// ─── Agent Definitions ────────────────────────────────────────────────────────

const AGENT_DEFINITIONS: Record<ManagedAgentType, {
  priority: ManagedAgentTask['priority'];
  guardrails: AgentGuardrail[];
  toolsAllowed: string[];
  sandboxIsolated: boolean;
  deadlineHours?: number;
}> = {
  SCREENING_AGENT: {
    priority: 'high',
    guardrails: STANDARD_GUARDRAILS,
    toolsAllowed: ['sanctions_screen', 'cdd_lookup', 'esg_scorer', 'pep_proximity', 'asana_write'],
    sandboxIsolated: false,
    deadlineHours: 8,
  },
  STR_FILING_AGENT: {
    priority: 'critical',
    guardrails: HIGH_STAKES_GUARDRAILS,
    toolsAllowed: ['goaml_submit', 'str_classifier', 'four_eyes_enforcer', 'asana_write'],
    sandboxIsolated: true,
    deadlineHours: 240,   // 10 business days
  },
  EDD_AGENT: {
    priority: 'high',
    guardrails: HIGH_STAKES_GUARDRAILS,
    toolsAllowed: ['cdd_lookup', 'pep_proximity', 'corporate_graph', 'ubo_verify', 'asana_write'],
    sandboxIsolated: false,
    deadlineHours: 72,
  },
  FREEZE_AGENT: {
    priority: 'critical',
    guardrails: HIGH_STAKES_GUARDRAILS,
    toolsAllowed: ['asset_freeze_execute', 'eocn_notify', 'goaml_submit', 'asana_write'],
    sandboxIsolated: true,
    deadlineHours: 24,    // Cabinet Res 74/2020 Art.4
  },
  KYC_RENEWAL_AGENT: {
    priority: 'medium',
    guardrails: STANDARD_GUARDRAILS,
    toolsAllowed: ['cdd_lookup', 'kyc_consistency_check', 'sanctions_screen', 'asana_write'],
    sandboxIsolated: false,
    deadlineHours: 48,
  },
  ESG_AUDIT_AGENT: {
    priority: 'medium',
    guardrails: STANDARD_GUARDRAILS,
    toolsAllowed: ['esg_scorer', 'carbon_estimator', 'tcfd_checker', 'sdg_scorer', 'conflict_minerals', 'asana_write'],
    sandboxIsolated: false,
    deadlineHours: 72,
  },
  ASANA_SYNC_AGENT: {
    priority: 'low',
    guardrails: STANDARD_GUARDRAILS,
    toolsAllowed: ['asana_write', 'asana_read', 'asana_update'],
    sandboxIsolated: false,
  },
  REPORT_AGENT: {
    priority: 'medium',
    guardrails: STANDARD_GUARDRAILS,
    toolsAllowed: ['screening_report', 'kpi_dashboard', 'mlro_alerts', 'asana_write'],
    sandboxIsolated: false,
    deadlineHours: 24,
  },
};

// ─── Session Factory ──────────────────────────────────────────────────────────

let sessionCounter = 0;

export function createOrchestratorSession(entityId: string): OrchestratorSession {
  return {
    sessionId: `SESS-${entityId.replace(/\W/g, '').slice(0, 8).toUpperCase()}-${Date.now()}-${++sessionCounter}`,
    entityId,
    startedAt: new Date().toISOString(),
    activeAgents: [],
    completedAgents: [],
    failedAgents: [],
    overallStatus: 'pending',
    auditLog: [],
  };
}

export function spawnManagedAgent(
  session: OrchestratorSession,
  agentType: ManagedAgentType,
  entityName: string,
  triggeredBy: string,
): ManagedAgentTask {
  const def = AGENT_DEFINITIONS[agentType];
  const now = new Date().toISOString();
  const deadline = def.deadlineHours
    ? new Date(Date.now() + def.deadlineHours * 3_600_000).toISOString()
    : undefined;

  const task: ManagedAgentTask = {
    taskId: `${agentType.slice(0, 4)}-${session.sessionId}-${Date.now()}`,
    agentType,
    entityId: session.entityId,
    entityName,
    priority: def.priority,
    triggeredBy,
    triggeredAt: now,
    deadline,
    guardrails: def.guardrails,
    toolsAllowed: def.toolsAllowed,
    sessionId: session.sessionId,
    sandboxIsolated: def.sandboxIsolated,
    status: 'pending',
  };

  session.activeAgents.push(task);
  session.auditLog.push(`[${now}] Agent ${agentType} spawned for ${session.entityId} — triggered by: ${triggeredBy}`);

  return task;
}

/**
 * Determine which managed agents to spawn based on a WeaponizedBrain verdict.
 * Returns the agent types to launch in priority order.
 */
export function resolveAgentsForVerdict(
  verdict: string,
  extensions: {
    filingClassification?: { primaryCategory: string };
    pepProximity?: { requiresBoardApproval: boolean };
    esgScore?: { riskLevel: string };
    hawala?: { requiresCbuaeReport: boolean };
    crossBorderCash?: { structuringDetected: boolean };
  },
): ManagedAgentType[] {
  const agents: ManagedAgentType[] = [];

  // FREEZE → spawn in strict priority order
  if (verdict === 'freeze') {
    agents.push('FREEZE_AGENT');         // 24h EOCN — highest priority
    agents.push('STR_FILING_AGENT');     // CNMR filing
    agents.push('ASANA_SYNC_AGENT');     // task tree
    agents.push('REPORT_AGENT');
    return agents;
  }

  // ESCALATE
  if (verdict === 'escalate') {
    agents.push('EDD_AGENT');
    if (extensions.filingClassification?.primaryCategory &&
        extensions.filingClassification.primaryCategory !== 'NONE') {
      agents.push('STR_FILING_AGENT');
    }
    if (extensions.pepProximity?.requiresBoardApproval) {
      agents.push('KYC_RENEWAL_AGENT');
    }
    agents.push('ASANA_SYNC_AGENT');
    agents.push('REPORT_AGENT');
    return agents;
  }

  // FLAG
  if (verdict === 'flag') {
    agents.push('SCREENING_AGENT');
    if (extensions.esgScore?.riskLevel === 'critical' || extensions.esgScore?.riskLevel === 'high') {
      agents.push('ESG_AUDIT_AGENT');
    }
    if (extensions.hawala?.requiresCbuaeReport || extensions.crossBorderCash?.structuringDetected) {
      agents.push('STR_FILING_AGENT');
    }
    agents.push('ASANA_SYNC_AGENT');
    agents.push('REPORT_AGENT');
    return agents;
  }

  // PASS — minimal sync
  agents.push('ASANA_SYNC_AGENT');
  return agents;
}

/**
 * Build a system prompt for a managed agent — injects guardrails, regulatory
 * context, and the Harness architecture directives.
 */
export function buildManagedAgentSystemPrompt(task: ManagedAgentTask): string {
  const guardrailBlock = task.guardrails
    .map(g => `- ${g.type.replace(/_/g, ' ').toUpperCase()}: ${g.regulatoryRef}`)
    .join('\n');

  return `You are a UAE AML/CFT compliance managed agent (${task.agentType}).

ENTITY: ${task.entityName} (${task.entityId})
TASK ID: ${task.taskId}
SESSION: ${task.sessionId}
TRIGGERED BY: ${task.triggeredBy}
PRIORITY: ${task.priority.toUpperCase()}
${task.deadline ? `DEADLINE: ${task.deadline}` : ''}
SANDBOX ISOLATED: ${task.sandboxIsolated}

## MANDATORY GUARDRAILS (cannot be overridden)
${guardrailBlock}

## TOOLS AVAILABLE
${task.toolsAllowed.map(t => `- ${t}`).join('\n')}

## COMPLIANCE RULES
1. NEVER tip off the subject of an investigation (FDL No.10/2025 Art.29 — criminal offence)
2. ALL actions must be logged with timestamp + user + action (FDL Art.24 — 10yr retention)
3. ALL sanctions screening must check 6 lists: UN, OFAC, EU, UK, UAE, EOCN
4. ANY freeze or STR decision requires four-eyes approval before execution
5. Use businessDays.ts for deadlines — never calendar days (except EOCN 24h clock)
6. Threshold constants ONLY from src/domain/constants.ts — never hardcode AED values
7. Date format: dd/mm/yyyy for UAE compliance documents

## REGULATORY FRAMEWORK
FDL No.10/2025 | Cabinet Res 134/2025 | Cabinet Res 74/2020 | MoE Circular 08/AML/2021 |
Cabinet Decision 109/2023 | Cabinet Res 71/2024 | FATF Rec 1-40 | LBMA RGG v9 | OECD DDG 2016

Complete your task. Report results in structured JSON. Escalate if uncertain.`;
}
