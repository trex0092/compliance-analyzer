/**
 * Learned Priority Model — ranks pending Asana tasks by urgency,
 * blending regulatory deadline, workload, and feedback-loop weights.
 *
 * Why this exists:
 *   Today pending tasks are sorted by creation time. MLROs work
 *   through their queue top-down. That misses cases where a
 *   regulatory deadline is about to breach or a Tier B auto-
 *   remediation depends on the task being actioned first.
 *
 *   This module is the pure ranker. It combines:
 *     - Regulatory urgency (hours remaining in SLA)
 *     - Verdict severity (freeze > escalate > flag > pass)
 *     - Customer-cohort risk (higher-tier customers rank higher)
 *     - Feedback-loop weights (features that historically got
 *       escalated by MLROs get a bump)
 *     - Assigned CO's current load (load-averse routing)
 *
 *   Pure function. Same input → same ranking.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO prioritisation)
 *   Cabinet Res 74/2020 Art.4-7 (SLA urgency)
 *   Cabinet Res 134/2025 Art.19 (internal review)
 *   FATF Rec 1               (risk-based resource allocation)
 *   NIST AI RMF 1.0 MANAGE-2 (AI-informed prioritisation)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Verdict = 'pass' | 'flag' | 'escalate' | 'freeze';
export type RiskTier = 'SDD' | 'CDD' | 'EDD' | 'PEP';

export interface PendingTask {
  taskGid: string;
  tenantId: string;
  caseId: string;
  verdict: Verdict;
  riskTier: RiskTier;
  /** Hours remaining in the SLA window. Negative = breached. */
  slaHoursRemaining: number;
  /** Assigned CO's current load (pending approvals + in-flight). */
  assignedCoLoad: number;
  /** Top feature contributing to the case (from feedback weights). */
  topFeature: string;
  /** Feedback-loop weight for the top feature (default 1.0). */
  topFeatureWeight: number;
}

export interface RankedTask {
  task: PendingTask;
  priority: number;
  rank: number;
  reason: string;
}

export interface PriorityReport {
  schemaVersion: 1;
  totalTasks: number;
  ranked: readonly RankedTask[];
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const VERDICT_WEIGHT: Record<Verdict, number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 4,
};

const RISK_TIER_WEIGHT: Record<RiskTier, number> = {
  SDD: 0.5,
  CDD: 1.0,
  EDD: 1.5,
  PEP: 2.0,
};

function urgencyFromSla(hoursRemaining: number): number {
  if (hoursRemaining <= 0) return 10; // breached — highest urgency
  if (hoursRemaining <= 2) return 8;
  if (hoursRemaining <= 4) return 6;
  if (hoursRemaining <= 12) return 4;
  if (hoursRemaining <= 24) return 2;
  return 1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function rankPendingTasks(tasks: readonly PendingTask[]): PriorityReport {
  const scored: Array<RankedTask & { _priority: number }> = tasks.map((t) => {
    const slaUrgency = urgencyFromSla(t.slaHoursRemaining);
    const verdictWeight = VERDICT_WEIGHT[t.verdict];
    const tierWeight = RISK_TIER_WEIGHT[t.riskTier];
    const feedbackWeight = Math.max(0.5, Math.min(2, t.topFeatureWeight));
    // Load-averse: higher CO load reduces priority of THIS task (spread the pain).
    const loadPenalty = Math.min(2, t.assignedCoLoad / 10);

    const priority =
      slaUrgency * 3 + verdictWeight * 2 + tierWeight + feedbackWeight - loadPenalty;

    return {
      task: t,
      _priority: priority,
      priority,
      rank: 0,
      reason:
        `SLA urgency ${slaUrgency}/10 · ` +
        `verdict ${t.verdict} (${verdictWeight}) · ` +
        `tier ${t.riskTier} (${tierWeight}) · ` +
        `feedback weight ${feedbackWeight.toFixed(2)} · ` +
        `CO load ${t.assignedCoLoad} (-${loadPenalty.toFixed(2)})`,
    };
  });

  scored.sort((a, b) => b._priority - a._priority);
  const ranked: RankedTask[] = scored.map((r, i) => ({
    task: r.task,
    priority: r._priority,
    rank: i + 1,
    reason: r.reason,
  }));

  return {
    schemaVersion: 1,
    totalTasks: tasks.length,
    ranked,
    summary:
      tasks.length === 0
        ? 'No pending tasks to rank.'
        : `Ranked ${tasks.length} task(s). Top-priority: ${ranked[0]!.task.taskGid} (priority ${ranked[0]!.priority.toFixed(2)}).`,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 74/2020 Art.4-7',
      'Cabinet Res 134/2025 Art.19',
      'FATF Rec 1',
      'NIST AI RMF 1.0 MANAGE-2',
    ],
  };
}

// Exports for tests.
export const __test__ = { urgencyFromSla, VERDICT_WEIGHT, RISK_TIER_WEIGHT };
