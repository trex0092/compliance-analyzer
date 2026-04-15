/**
 * Asana CO Load Balancer — workload-aware four-eyes assignment.
 *
 * Why this exists:
 *   The existing four-eyes pair creator picks Approver B by stable
 *   round-robin keyed on caseId. That works under normal load but
 *   breaks during incident bursts: when 50 freeze tasks land in
 *   the same minute, the round-robin sends them all to ONE CO
 *   while everyone else has zero queue depth. The bottleneck CO
 *   blows their 8h SLA; the rest of the team stays idle.
 *
 *   This module is the workload-aware allocator. It walks the CO
 *   pool, scores each candidate by `pendingApprovalCount + 0.5 *
 *   inFlightCaseCount`, and picks the lowest-loaded CO who is:
 *     - active (not on leave)
 *     - in the right role pool
 *     - NOT the proposer of this case (self-approval rejection)
 *
 *   Pure function — same input → same assignee. The caller
 *   (fourEyesSubtaskCreator) feeds it the live CO pool snapshot.
 *   No I/O, no state, no Asana calls.
 *
 *   Falls back to round-robin when load data is missing — never
 *   blocks a four-eyes pair from being created.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO continuous monitoring + load fairness)
 *   Cabinet Res 134/2025 Art.12-14 (four-eyes — second approver
 *                                    must be different person)
 *   Cabinet Res 74/2020 Art.4-7 (24h freeze SLA — load balancing
 *                                  is the only way to meet it under burst)
 *   FATF Rec 1               (operational risk management)
 *   NIST AI RMF 1.0 MANAGE-2 (resource allocation)
 *   EU AI Act Art.14         (human oversight — even loading)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoCandidate {
  /** Asana user GID. */
  gid: string;
  /** Display name (informational only). */
  name: string;
  /** Role — controls eligibility for the requested four-eyes role. */
  role: 'analyst' | 'mlro' | 'co' | 'board';
  /** Whether the CO is active (not on leave / OOO). */
  active: boolean;
  /** Number of approval tasks currently pending for this CO. */
  pendingApprovalCount: number;
  /** Number of in-flight cases assigned to this CO. */
  inFlightCaseCount: number;
}

export interface AssignmentRequest {
  /** Pool of candidates to choose from. */
  candidates: readonly CoCandidate[];
  /**
   * Required role for the assignment. CO+ for break-glass approvals,
   * MLRO+ for STR review, etc.
   */
  requiredRole: 'analyst' | 'mlro' | 'co' | 'board';
  /**
   * GID of the proposer — excluded from the candidate pool to enforce
   * self-approval rejection at the assignment layer.
   */
  proposerGid: string;
  /**
   * Stable case id — used by the round-robin fallback when load data
   * is missing across the whole pool.
   */
  caseId: string;
}

export interface AssignmentResult {
  /** Chosen assignee — null when no eligible candidate exists. */
  assigneeGid: string | null;
  /** Strategy actually used to pick the assignee. */
  strategy: 'load-balanced' | 'round-robin-fallback' | 'no-eligible-candidate';
  /** Plain-English reason for the audit log. */
  reason: string;
  /** Eligible pool size after exclusion + role filter. */
  eligiblePoolSize: number;
  /** Regulatory anchor. */
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<CoCandidate['role'], number> = {
  analyst: 0,
  mlro: 1,
  co: 2,
  board: 3,
};

// Weight applied to in-flight case count. Pending approvals are
// weighted 1.0 because they have a hard SLA; in-flight cases are
// weighted 0.5 because they are slower-moving.
const IN_FLIGHT_WEIGHT = 0.5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function meetsRole(candidate: CoCandidate, required: CoCandidate['role']): boolean {
  return ROLE_RANK[candidate.role] >= ROLE_RANK[required];
}

function loadScore(c: CoCandidate): number {
  return c.pendingApprovalCount + IN_FLIGHT_WEIGHT * c.inFlightCaseCount;
}

function fnv1aMod(input: string, mod: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return mod > 0 ? h % mod : 0;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pick the best Approver B for a four-eyes pair. Pure function. Same
 * inputs → same output. Never throws.
 *
 * Strategy:
 *   1. Filter the pool: active + role + exclude proposer.
 *   2. If the eligible pool is empty → no_eligible_candidate.
 *   3. If every candidate has zero pendingApprovalCount AND zero
 *      inFlightCaseCount → fall back to stable round-robin keyed on
 *      caseId (so the same case always lands on the same CO when
 *      load data is missing).
 *   4. Otherwise → pick the lowest loadScore. Ties broken by
 *      lexicographic gid for stability.
 */
export function pickFourEyesAssignee(req: AssignmentRequest): AssignmentResult {
  const eligible = req.candidates.filter(
    (c) => c.active && meetsRole(c, req.requiredRole) && c.gid !== req.proposerGid
  );

  if (eligible.length === 0) {
    return {
      assigneeGid: null,
      strategy: 'no-eligible-candidate',
      reason:
        `No eligible four-eyes assignee found for role ${req.requiredRole} ` +
        `(pool size ${req.candidates.length}, proposer ${req.proposerGid}). ` +
        `Escalate to next role tier.`,
      eligiblePoolSize: 0,
      regulatory: ['Cabinet Res 134/2025 Art.12-14'],
    };
  }

  // If every candidate has zero load, fall back to deterministic
  // round-robin so cron-time ordering does not surprise operators.
  const allZeroLoad = eligible.every((c) => loadScore(c) === 0);
  if (allZeroLoad) {
    const idx = fnv1aMod(req.caseId, eligible.length);
    const chosen = [...eligible].sort((a, b) => a.gid.localeCompare(b.gid))[idx]!;
    return {
      assigneeGid: chosen.gid,
      strategy: 'round-robin-fallback',
      reason:
        `Load data unavailable for the eligible pool — fell back to ` +
        `stable round-robin keyed on caseId. Picked ${chosen.name} (${chosen.gid}).`,
      eligiblePoolSize: eligible.length,
      regulatory: ['Cabinet Res 134/2025 Art.12-14'],
    };
  }

  // Lowest load wins; ties broken by lexicographic gid for stability.
  const sorted = [...eligible].sort((a, b) => {
    const la = loadScore(a);
    const lb = loadScore(b);
    if (la !== lb) return la - lb;
    return a.gid.localeCompare(b.gid);
  });
  const chosen = sorted[0]!;
  return {
    assigneeGid: chosen.gid,
    strategy: 'load-balanced',
    reason:
      `Load-balanced four-eyes assignment: ${chosen.name} (${chosen.gid}) ` +
      `with load score ${loadScore(chosen).toFixed(1)} ` +
      `(${chosen.pendingApprovalCount} pending + ${chosen.inFlightCaseCount} in-flight). ` +
      `Eligible pool: ${eligible.length}.`,
    eligiblePoolSize: eligible.length,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 134/2025 Art.12-14',
      'Cabinet Res 74/2020 Art.4-7',
      'FATF Rec 1',
      'NIST AI RMF 1.0 MANAGE-2',
      'EU AI Act Art.14',
    ],
  };
}

// Exports for tests.
export const __test__ = { meetsRole, loadScore, fnv1aMod, ROLE_RANK };
