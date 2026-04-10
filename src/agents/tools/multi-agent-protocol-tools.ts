/**
 * Multi-Agent Collaboration Protocol
 *
 * Enables agents to communicate findings, share context,
 * and coordinate decisions in real-time:
 * 1. Agent message bus — typed inter-agent messaging
 * 2. Shared blackboard — agents post findings for others to read
 * 3. Consensus protocol — multiple agents vote on decisions
 * 4. Task delegation — agents can spawn sub-tasks for other agents
 * 5. Conflict resolution — when agents disagree
 *
 * This turns isolated agents into a collaborative team that
 * can tackle complex compliance investigations together.
 */

import type { ToolResult as _ToolResult } from '../mcp-server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentRole =
  | 'screening'
  | 'onboarding'
  | 'incident'
  | 'filing'
  | 'audit'
  | 'risk-analysis'
  | 'network-analysis'
  | 'transaction-monitoring';

export interface AgentIdentity {
  id: string;
  role: AgentRole;
  name: string;
  capabilities: string[];
  status: 'idle' | 'busy' | 'waiting' | 'completed';
}

export interface InterAgentMessage {
  id: string;
  from: string; // agent ID
  to: string | 'broadcast'; // agent ID or 'broadcast'
  type: 'finding' | 'request' | 'response' | 'alert' | 'vote' | 'delegation';
  priority: 'low' | 'medium' | 'high' | 'critical';
  subject: string;
  body: unknown;
  timestamp: string;
  correlationId?: string;
  requiresResponse: boolean;
  responseDeadlineMs?: number;
}

export interface BlackboardEntry {
  id: string;
  agentId: string;
  agentRole: AgentRole;
  category: 'finding' | 'risk-indicator' | 'recommendation' | 'evidence' | 'decision';
  title: string;
  content: unknown;
  confidence: number;
  timestamp: string;
  tags: string[];
  readBy: string[];
  supersedes?: string; // ID of entry this replaces
}

export interface ConsensusVote {
  agentId: string;
  agentRole: AgentRole;
  decision: string;
  confidence: number;
  reasoning: string;
  timestamp: string;
}

export interface ConsensusResult {
  proposalId: string;
  question: string;
  votes: ConsensusVote[];
  consensus: string | null;
  agreementRatio: number;
  confidence: number;
  resolved: boolean;
  conflictsDetected: boolean;
  resolution?: string;
}

export interface DelegatedTask {
  id: string;
  fromAgent: string;
  toAgent: string;
  taskType: string;
  description: string;
  input: unknown;
  status: 'pending' | 'accepted' | 'in-progress' | 'completed' | 'failed';
  result?: unknown;
  createdAt: string;
  completedAt?: string;
}

export interface CollaborationReport {
  sessionId: string;
  duration: string;
  activeAgents: AgentIdentity[];
  messagesExchanged: number;
  blackboardEntries: number;
  consensusDecisions: number;
  delegatedTasks: number;
  conflicts: number;
  findings: BlackboardEntry[];
  decisions: ConsensusResult[];
}

// ---------------------------------------------------------------------------
// Collaboration Hub
// ---------------------------------------------------------------------------

export class AgentCollaborationHub {
  private agents = new Map<string, AgentIdentity>();
  private messages: InterAgentMessage[] = [];
  private blackboard: BlackboardEntry[] = [];
  private consensusProposals = new Map<string, ConsensusResult>();
  private delegatedTasks = new Map<string, DelegatedTask>();
  private messageHandlers = new Map<string, (msg: InterAgentMessage) => void>();
  private conflictCount = 0;

  /** Register an agent */
  registerAgent(agent: AgentIdentity): void {
    this.agents.set(agent.id, agent);
  }

  /** Unregister */
  unregisterAgent(agentId: string): void {
    this.agents.delete(agentId);
    this.messageHandlers.delete(agentId);
  }

  /** Set message handler for an agent */
  onMessage(agentId: string, handler: (msg: InterAgentMessage) => void): void {
    this.messageHandlers.set(agentId, handler);
  }

  // ---- Messaging ----

  /** Send a message between agents */
  sendMessage(message: Omit<InterAgentMessage, 'id' | 'timestamp'>): InterAgentMessage {
    const msg: InterAgentMessage = {
      ...message,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(msg);

    // Deliver
    if (msg.to === 'broadcast') {
      for (const [agentId, handler] of this.messageHandlers) {
        if (agentId !== msg.from) handler(msg);
      }
    } else {
      this.messageHandlers.get(msg.to)?.(msg);
    }

    return msg;
  }

  /** Get messages for an agent */
  getMessages(agentId: string, _unreadOnly = false): InterAgentMessage[] {
    return this.messages.filter(
      (m) => (m.to === agentId || m.to === 'broadcast') && m.from !== agentId
    );
  }

  // ---- Blackboard ----

  /** Post a finding to the shared blackboard */
  postToBlackboard(entry: Omit<BlackboardEntry, 'id' | 'timestamp' | 'readBy'>): BlackboardEntry {
    const full: BlackboardEntry = {
      ...entry,
      id: `bb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      readBy: [],
    };
    this.blackboard.push(full);

    // Notify all agents of new finding
    this.sendMessage({
      from: entry.agentId,
      to: 'broadcast',
      type: 'finding',
      priority: entry.confidence > 0.8 ? 'high' : 'medium',
      subject: `New ${entry.category}: ${entry.title}`,
      body: { blackboardEntryId: full.id, category: entry.category, confidence: entry.confidence },
      requiresResponse: false,
    });

    return full;
  }

  /** Read blackboard entries */
  readBlackboard(
    agentId: string,
    filters?: {
      category?: BlackboardEntry['category'];
      tags?: string[];
      minConfidence?: number;
    }
  ): BlackboardEntry[] {
    let entries = [...this.blackboard];

    if (filters?.category) {
      entries = entries.filter((e) => e.category === filters.category);
    }
    if (filters?.tags?.length) {
      entries = entries.filter((e) => filters.tags!.some((t) => e.tags.includes(t)));
    }
    if (filters?.minConfidence) {
      entries = entries.filter((e) => e.confidence >= filters.minConfidence!);
    }

    // Mark as read
    for (const entry of entries) {
      if (!entry.readBy.includes(agentId)) {
        entry.readBy.push(agentId);
      }
    }

    return entries;
  }

  // ---- Consensus ----

  /** Propose a decision for consensus voting */
  proposeConsensus(question: string, proposedBy: string): string {
    const id = `consensus-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.consensusProposals.set(id, {
      proposalId: id,
      question,
      votes: [],
      consensus: null,
      agreementRatio: 0,
      confidence: 0,
      resolved: false,
      conflictsDetected: false,
    });

    // Broadcast to all agents
    this.sendMessage({
      from: proposedBy,
      to: 'broadcast',
      type: 'vote',
      priority: 'high',
      subject: `Vote requested: ${question}`,
      body: { proposalId: id, question },
      requiresResponse: true,
      responseDeadlineMs: 30_000,
    });

    return id;
  }

  /** Cast a vote on a consensus proposal */
  castVote(proposalId: string, vote: Omit<ConsensusVote, 'timestamp'>): void {
    const proposal = this.consensusProposals.get(proposalId);
    if (!proposal || proposal.resolved) return;

    proposal.votes.push({
      ...vote,
      timestamp: new Date().toISOString(),
    });

    // Check for consensus
    this.evaluateConsensus(proposalId);
  }

  /** Evaluate if consensus has been reached */
  private evaluateConsensus(proposalId: string): void {
    const proposal = this.consensusProposals.get(proposalId);
    if (!proposal) return;

    const totalAgents = this.agents.size;
    if (proposal.votes.length < Math.ceil(totalAgents * 0.5)) return; // need majority

    // Count decisions
    const decisionCounts = new Map<string, { count: number; totalConfidence: number }>();
    for (const vote of proposal.votes) {
      const entry = decisionCounts.get(vote.decision) ?? { count: 0, totalConfidence: 0 };
      entry.count++;
      entry.totalConfidence += vote.confidence;
      decisionCounts.set(vote.decision, entry);
    }

    // Find majority
    let bestDecision = '';
    let bestCount = 0;
    for (const [decision, data] of decisionCounts) {
      if (data.count > bestCount) {
        bestCount = data.count;
        bestDecision = decision;
      }
    }

    const agreementRatio = bestCount / proposal.votes.length;
    const avgConfidence = (decisionCounts.get(bestDecision)?.totalConfidence ?? 0) / bestCount;

    proposal.agreementRatio = Math.round(agreementRatio * 100) / 100;
    proposal.confidence = Math.round(avgConfidence * 100) / 100;

    if (agreementRatio >= 0.6) {
      proposal.consensus = bestDecision;
      proposal.resolved = true;
      proposal.conflictsDetected = decisionCounts.size > 1;

      if (proposal.conflictsDetected) {
        this.conflictCount++;
        // Build resolution narrative
        const dissenting = proposal.votes.filter((v) => v.decision !== bestDecision);
        proposal.resolution =
          `Majority (${(agreementRatio * 100).toFixed(0)}%) voted "${bestDecision}". ` +
          `${dissenting.length} dissenting vote(s): ${dissenting.map((v) => `${v.agentRole} voted "${v.decision}" (${v.reasoning})`).join('; ')}`;
      }
    }
  }

  /** Get consensus result */
  getConsensusResult(proposalId: string): ConsensusResult | undefined {
    return this.consensusProposals.get(proposalId);
  }

  // ---- Task Delegation ----

  /** Delegate a task to another agent */
  delegateTask(task: Omit<DelegatedTask, 'id' | 'status' | 'createdAt'>): DelegatedTask {
    const full: DelegatedTask = {
      ...task,
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    this.delegatedTasks.set(full.id, full);

    this.sendMessage({
      from: task.fromAgent,
      to: task.toAgent,
      type: 'delegation',
      priority: 'high',
      subject: `Task delegated: ${task.description}`,
      body: { taskId: full.id, taskType: task.taskType, input: task.input },
      requiresResponse: true,
    });

    return full;
  }

  /** Complete a delegated task */
  completeTask(taskId: string, result: unknown): void {
    const task = this.delegatedTasks.get(taskId);
    if (!task) return;
    task.status = 'completed';
    task.result = result;
    task.completedAt = new Date().toISOString();

    this.sendMessage({
      from: task.toAgent,
      to: task.fromAgent,
      type: 'response',
      priority: 'medium',
      subject: `Task completed: ${task.description}`,
      body: { taskId, result },
      requiresResponse: false,
    });
  }

  // ---- Reporting ----

  generateReport(): CollaborationReport {
    return {
      sessionId: `collab-${Date.now()}`,
      duration:
        this.messages.length > 0
          ? `${Math.round((Date.now() - new Date(this.messages[0].timestamp).getTime()) / 1000)}s`
          : '0s',
      activeAgents: Array.from(this.agents.values()),
      messagesExchanged: this.messages.length,
      blackboardEntries: this.blackboard.length,
      consensusDecisions: Array.from(this.consensusProposals.values()).filter((p) => p.resolved)
        .length,
      delegatedTasks: this.delegatedTasks.size,
      conflicts: this.conflictCount,
      findings: this.blackboard.filter(
        (e) => e.category === 'finding' || e.category === 'risk-indicator'
      ),
      decisions: Array.from(this.consensusProposals.values()).filter((p) => p.resolved),
    };
  }
}

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------

export const COLLABORATION_TOOL_SCHEMAS = [
  {
    name: 'agent_post_finding',
    description:
      'Post a finding to the shared blackboard for other agents to read. Used for inter-agent knowledge sharing during complex investigations.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        agentRole: { type: 'string' },
        category: {
          type: 'string',
          enum: ['finding', 'risk-indicator', 'recommendation', 'evidence', 'decision'],
        },
        title: { type: 'string' },
        content: { type: 'object' },
        confidence: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['agentId', 'agentRole', 'category', 'title', 'content', 'confidence', 'tags'],
    },
  },
  {
    name: 'agent_propose_consensus',
    description:
      'Propose a decision for multi-agent voting. All registered agents vote on the question and consensus is reached by majority.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        proposedBy: { type: 'string' },
      },
      required: ['question', 'proposedBy'],
    },
  },
  {
    name: 'get_collaboration_report',
    description:
      'Get a report of all multi-agent collaboration activity: messages, findings, consensus decisions, delegated tasks, and conflicts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
] as const;
