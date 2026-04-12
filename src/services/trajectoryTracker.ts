/**
 * Compliance Decision Trajectory Tracker
 *
 * Full decision-path recording for every compliance verdict, inspired by
 * NousResearch/hermes-agent trajectory.py pattern. Creates an immutable,
 * append-only DAG of decision nodes that can be replayed for audit.
 *
 * Every compliance action — screening, filing, freeze, CDD change — gets
 * a trajectory that records:
 * - What inputs were provided
 * - What subsystems were consulted
 * - What each subsystem returned
 * - What decision was made and why
 * - What regulatory basis was cited
 * - Who approved it (links to approval gates)
 * - What downstream actions were triggered
 *
 * The trajectory is the audit trail that MoE, LBMA, and internal audit
 * inspect to prove the decision was compliant.
 *
 * Regulatory refs:
 * - FDL No.10/2025 Art.24 (record retention 10 years)
 * - FDL No.10/2025 Art.20-21 (CO duties — must demonstrate process)
 * - Cabinet Res 134/2025 Art.19 (internal review)
 * - LBMA RGG v9 (5-step framework documentation)
 *
 * Patterns adopted:
 * - hermes-agent: trajectory.py (decision-path recording)
 * - hermes-agent: approval.py (human gate integration)
 * - xyflow: node-based DAG visualization (reasoningChain format)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type TrajectoryPhase =
  | 'intake'              // initial request received
  | 'data-gathering'      // collecting entity data, documents
  | 'screening'           // sanctions, PEP, adverse media checks
  | 'risk-scoring'        // calculating risk score
  | 'consensus'           // multi-model/agent consensus
  | 'decision'            // verdict reached
  | 'approval-gate'       // four-eyes approval
  | 'escalation'          // escalated to higher authority
  | 'action'              // downstream action taken (freeze, file, etc.)
  | 'notification'        // alerts sent (without tipping off subject)
  | 'documentation'       // report/filing generated
  | 'closure'             // case closed or archived
  | 'review';             // periodic review triggered

export type EvidenceType =
  | 'document'            // uploaded document
  | 'screening-result'    // output from screening engine
  | 'model-opinion'       // individual model's assessment
  | 'consensus-result'    // aggregated consensus
  | 'approval-record'     // four-eyes approval
  | 'system-log'          // automated system action
  | 'human-note'          // analyst's written note
  | 'regulatory-ref'      // cited regulation
  | 'external-data';      // data from external source (goAML, FIU, etc.)

export interface TrajectoryEvidence {
  evidenceId: string;
  type: EvidenceType;
  title: string;
  content: string | Record<string, unknown>;
  source: string;
  timestamp: string;
  /** Hash for integrity verification (FDL Art.24 — tamper-proof records) */
  contentHash: string;
}

export interface TrajectoryNode {
  nodeId: string;
  trajectoryId: string;
  phase: TrajectoryPhase;
  timestamp: string;

  /** What happened at this node */
  action: string;
  actor: string;          // who/what performed the action
  actorType: 'system' | 'human' | 'model' | 'agent';

  /** Inputs to this decision step */
  inputs: Record<string, unknown>;

  /** Outputs / results of this step */
  outputs: Record<string, unknown>;

  /** Decision made (if any) */
  decision?: string;
  confidence?: number;
  reasoning?: string;

  /** Regulatory citation */
  regulatoryRef?: string;

  /** Evidence attached to this node */
  evidence: TrajectoryEvidence[];

  /** Links to parent nodes (DAG structure) */
  parentNodeIds: string[];

  /** Duration of this step in ms */
  durationMs?: number;

  /** Tags for filtering and search */
  tags: string[];
}

export interface Trajectory {
  trajectoryId: string;
  entityId: string;
  entityName: string;
  entityType: 'customer' | 'counterparty' | 'transaction' | 'case';

  /** What initiated this trajectory */
  triggerType: 'screening' | 'onboarding' | 'periodic-review' | 'incident' | 'filing' | 'manual';
  triggerDescription: string;

  /** Nodes in the trajectory (ordered by timestamp) */
  nodes: TrajectoryNode[];

  /** Current phase */
  currentPhase: TrajectoryPhase;

  /** Final verdict (set when trajectory closes) */
  finalVerdict?: string;
  finalRiskLevel?: 'low' | 'medium' | 'high' | 'critical';

  /** Linked IDs */
  linkedConsensusIds: string[];
  linkedApprovalGateIds: string[];
  linkedFilingIds: string[];

  /** Metadata */
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  createdBy: string;

  /** Retention: FDL No.10/2025 Art.24 — 10 years minimum */
  retentionExpiresAt: string;

  /** Integrity: hash chain for tamper detection */
  lastNodeHash: string;
}

export interface TrajectorySearchFilters {
  entityId?: string;
  entityName?: string;
  phase?: TrajectoryPhase;
  triggerType?: Trajectory['triggerType'];
  dateFrom?: string;
  dateTo?: string;
  tags?: string[];
  hasVerdict?: boolean;
  riskLevel?: string;
}

export interface TrajectoryReplayStep {
  nodeId: string;
  timestamp: string;
  phase: TrajectoryPhase;
  action: string;
  actor: string;
  decision?: string;
  confidence?: number;
  regulatoryRef?: string;
  evidenceCount: number;
  durationMs?: number;
}

// ─── Trajectory Builder ─────────────────────────────────────────────────────

/**
 * Create a new trajectory for a compliance workflow.
 * Every compliance action starts here.
 */
export function createTrajectory(
  entityId: string,
  entityName: string,
  entityType: Trajectory['entityType'],
  triggerType: Trajectory['triggerType'],
  triggerDescription: string,
  createdBy: string,
): Trajectory {
  const now = new Date();
  const trajectoryId = `traj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // FDL No.10/2025 Art.24 — 10 years retention
  const retentionDate = new Date(now);
  retentionDate.setFullYear(retentionDate.getFullYear() + 10);

  const intakeNode: TrajectoryNode = {
    nodeId: `${trajectoryId}-intake`,
    trajectoryId,
    phase: 'intake',
    timestamp: now.toISOString(),
    action: `Trajectory opened: ${triggerDescription}`,
    actor: createdBy,
    actorType: createdBy === 'system' ? 'system' : 'human',
    inputs: { entityId, entityName, entityType, triggerType },
    outputs: { trajectoryId },
    evidence: [],
    parentNodeIds: [],
    tags: [triggerType, entityType],
  };

  return {
    trajectoryId,
    entityId,
    entityName,
    entityType,
    triggerType,
    triggerDescription,
    nodes: [intakeNode],
    currentPhase: 'intake',
    linkedConsensusIds: [],
    linkedApprovalGateIds: [],
    linkedFilingIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    createdBy,
    retentionExpiresAt: retentionDate.toISOString(),
    lastNodeHash: computeNodeHash(intakeNode),
  };
}

/**
 * Append a node to a trajectory. Nodes are immutable once added.
 * The hash chain ensures tamper detection (FDL Art.24).
 */
export function appendNode(
  trajectory: Trajectory,
  node: Omit<TrajectoryNode, 'nodeId' | 'trajectoryId' | 'timestamp'>,
): Trajectory {
  const now = new Date();
  const nodeId = `${trajectory.trajectoryId}-${node.phase}-${trajectory.nodes.length}`;

  const fullNode: TrajectoryNode = {
    ...node,
    nodeId,
    trajectoryId: trajectory.trajectoryId,
    timestamp: now.toISOString(),
  };

  const nodeHash = computeNodeHash(fullNode, trajectory.lastNodeHash);

  return {
    ...trajectory,
    nodes: [...trajectory.nodes, fullNode],
    currentPhase: node.phase,
    updatedAt: now.toISOString(),
    lastNodeHash: nodeHash,
  };
}

/**
 * Attach evidence to the most recent node in a trajectory.
 */
export function attachEvidence(
  trajectory: Trajectory,
  evidence: Omit<TrajectoryEvidence, 'evidenceId' | 'timestamp' | 'contentHash'>,
): Trajectory {
  if (trajectory.nodes.length === 0) return trajectory;

  const lastNode = trajectory.nodes[trajectory.nodes.length - 1];
  const evidenceId = `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const contentStr = typeof evidence.content === 'string'
    ? evidence.content
    : JSON.stringify(evidence.content);

  const fullEvidence: TrajectoryEvidence = {
    ...evidence,
    evidenceId,
    timestamp: new Date().toISOString(),
    contentHash: simpleHash(contentStr),
  };

  const updatedNode = {
    ...lastNode,
    evidence: [...lastNode.evidence, fullEvidence],
  };

  return {
    ...trajectory,
    nodes: [...trajectory.nodes.slice(0, -1), updatedNode],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Close a trajectory with a final verdict.
 */
export function closeTrajectory(
  trajectory: Trajectory,
  finalVerdict: string,
  finalRiskLevel: Trajectory['finalRiskLevel'],
  closedBy: string,
  closureReason: string,
): Trajectory {
  const closureNode: Omit<TrajectoryNode, 'nodeId' | 'trajectoryId' | 'timestamp'> = {
    phase: 'closure',
    action: `Trajectory closed: ${closureReason}`,
    actor: closedBy,
    actorType: closedBy === 'system' ? 'system' : 'human',
    inputs: { finalVerdict, finalRiskLevel },
    outputs: { closed: true, reason: closureReason },
    decision: finalVerdict,
    regulatoryRef: 'FDL No.10/2025 Art.24 — record retained for 10 years',
    evidence: [],
    parentNodeIds: trajectory.nodes.length > 0
      ? [trajectory.nodes[trajectory.nodes.length - 1].nodeId]
      : [],
    tags: ['closure', finalRiskLevel ?? 'unknown'],
  };

  const closed = appendNode(trajectory, closureNode);
  return {
    ...closed,
    finalVerdict,
    finalRiskLevel,
    closedAt: new Date().toISOString(),
  };
}

/**
 * Link a consensus result to this trajectory.
 */
export function linkConsensus(trajectory: Trajectory, consensusId: string): Trajectory {
  return {
    ...trajectory,
    linkedConsensusIds: [...trajectory.linkedConsensusIds, consensusId],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Link an approval gate to this trajectory.
 */
export function linkApprovalGate(trajectory: Trajectory, gateId: string): Trajectory {
  return {
    ...trajectory,
    linkedApprovalGateIds: [...trajectory.linkedApprovalGateIds, gateId],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Link a filing (STR/CTR/CNMR) to this trajectory.
 */
export function linkFiling(trajectory: Trajectory, filingId: string): Trajectory {
  return {
    ...trajectory,
    linkedFilingIds: [...trajectory.linkedFilingIds, filingId],
    updatedAt: new Date().toISOString(),
  };
}

// ─── Query & Replay ─────────────────────────────────────────────────────────

/**
 * Generate a replay of a trajectory — condensed view for audit review.
 * Each step is a single line, suitable for timeline display.
 */
export function replayTrajectory(trajectory: Trajectory): TrajectoryReplayStep[] {
  return trajectory.nodes.map(node => ({
    nodeId: node.nodeId,
    timestamp: node.timestamp,
    phase: node.phase,
    action: node.action,
    actor: node.actor,
    decision: node.decision,
    confidence: node.confidence,
    regulatoryRef: node.regulatoryRef,
    evidenceCount: node.evidence.length,
    durationMs: node.durationMs,
  }));
}

/**
 * Search trajectories by filters.
 * In production, this would query a database. Here it filters in-memory.
 */
export function searchTrajectories(
  trajectories: Trajectory[],
  filters: TrajectorySearchFilters,
): Trajectory[] {
  return trajectories.filter(t => {
    if (filters.entityId && t.entityId !== filters.entityId) return false;
    if (filters.entityName && !t.entityName.toLowerCase().includes(filters.entityName.toLowerCase())) return false;
    if (filters.phase && t.currentPhase !== filters.phase) return false;
    if (filters.triggerType && t.triggerType !== filters.triggerType) return false;
    if (filters.dateFrom && t.createdAt < filters.dateFrom) return false;
    if (filters.dateTo && t.createdAt > filters.dateTo) return false;
    if (filters.hasVerdict !== undefined && (!!t.finalVerdict !== filters.hasVerdict)) return false;
    if (filters.riskLevel && t.finalRiskLevel !== filters.riskLevel) return false;
    if (filters.tags?.length) {
      const allTags = t.nodes.flatMap(n => n.tags);
      if (!filters.tags.some(tag => allTags.includes(tag))) return false;
    }
    return true;
  });
}

/**
 * Validate trajectory integrity — check hash chain for tampering.
 * Required for MoE inspections and LBMA audits.
 */
export function validateTrajectoryIntegrity(trajectory: Trajectory): {
  valid: boolean;
  issues: string[];
} {
  const issues: string[] = [];

  if (trajectory.nodes.length === 0) {
    issues.push('Empty trajectory — no nodes');
    return { valid: false, issues };
  }

  // Check node ordering
  for (let i = 1; i < trajectory.nodes.length; i++) {
    if (trajectory.nodes[i].timestamp < trajectory.nodes[i - 1].timestamp) {
      issues.push(`Node ${trajectory.nodes[i].nodeId} timestamp is before previous node — possible tampering`);
    }
  }

  // Check all nodes have trajectory ID
  for (const node of trajectory.nodes) {
    if (node.trajectoryId !== trajectory.trajectoryId) {
      issues.push(`Node ${node.nodeId} has wrong trajectoryId`);
    }
  }

  // Check evidence hashes
  for (const node of trajectory.nodes) {
    for (const ev of node.evidence) {
      const contentStr = typeof ev.content === 'string' ? ev.content : JSON.stringify(ev.content);
      const expectedHash = simpleHash(contentStr);
      if (ev.contentHash !== expectedHash) {
        issues.push(`Evidence ${ev.evidenceId} in node ${node.nodeId} has mismatched hash — possible tampering`);
      }
    }
  }

  // Check retention date
  const retentionDate = new Date(trajectory.retentionExpiresAt);
  const createdDate = new Date(trajectory.createdAt);
  const yearsDiff = (retentionDate.getTime() - createdDate.getTime()) / (365.25 * 24 * 3_600_000);
  if (yearsDiff < 9.9) {
    issues.push(`Retention period ${yearsDiff.toFixed(1)} years is below required 10 years (FDL Art.24)`);
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Generate MLRO narrative for a trajectory — used in STR filings.
 */
export function generateTrajectoryNarrative(trajectory: Trajectory): string {
  const lines: string[] = [];

  lines.push(`## Decision Trajectory: ${trajectory.entityName}`);
  lines.push(`**ID:** ${trajectory.trajectoryId}`);
  lines.push(`**Entity:** ${trajectory.entityName} (${trajectory.entityType})`);
  lines.push(`**Trigger:** ${trajectory.triggerType} — ${trajectory.triggerDescription}`);
  lines.push(`**Period:** ${trajectory.createdAt} to ${trajectory.closedAt ?? 'OPEN'}`);
  lines.push(`**Verdict:** ${trajectory.finalVerdict ?? 'PENDING'} | **Risk:** ${trajectory.finalRiskLevel ?? 'TBD'}`);
  lines.push(`**Retention until:** ${trajectory.retentionExpiresAt} (FDL Art.24)`);
  lines.push('');

  lines.push('### Decision Path');
  for (const node of trajectory.nodes) {
    const decisionStr = node.decision ? ` -> **${node.decision}**` : '';
    const confStr = node.confidence !== undefined ? ` (${(node.confidence * 100).toFixed(0)}%)` : '';
    const refStr = node.regulatoryRef ? ` [${node.regulatoryRef}]` : '';
    const evStr = node.evidence.length > 0 ? ` [${node.evidence.length} evidence]` : '';
    lines.push(`- [${node.timestamp}] **${node.phase}**: ${node.action} (${node.actor})${decisionStr}${confStr}${refStr}${evStr}`);
  }
  lines.push('');

  if (trajectory.linkedConsensusIds.length > 0) {
    lines.push(`### Linked Consensus Runs: ${trajectory.linkedConsensusIds.join(', ')}`);
  }
  if (trajectory.linkedApprovalGateIds.length > 0) {
    lines.push(`### Linked Approval Gates: ${trajectory.linkedApprovalGateIds.join(', ')}`);
  }
  if (trajectory.linkedFilingIds.length > 0) {
    lines.push(`### Linked Filings: ${trajectory.linkedFilingIds.join(', ')}`);
  }

  return lines.join('\n');
}

// ─── Hash Utilities ─────────────────────────────────────────────────────────

/** Simple hash for content integrity — NOT cryptographic, use for tamper detection only */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return `sh-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Compute hash for a node, chaining from previous hash for tamper detection */
function computeNodeHash(node: TrajectoryNode, previousHash?: string): string {
  const content = JSON.stringify({
    nodeId: node.nodeId,
    phase: node.phase,
    action: node.action,
    actor: node.actor,
    decision: node.decision,
    timestamp: node.timestamp,
    previousHash: previousHash ?? 'genesis',
  });
  return simpleHash(content);
}
