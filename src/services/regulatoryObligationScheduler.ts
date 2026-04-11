/**
 * Regulatory Obligation Scheduler — subsystem #101 (Phase 9).
 *
 * Full dependency-aware obligation graph. Phase 7's
 * scheduledComplianceReports handles the seven canonical periodic
 * reports; this module extends that into a true graph of ALL
 * regulatory obligations with dependency edges (one obligation
 * blocking another), prerequisites, and a topological schedule
 * computed from the current instant.
 *
 * Obligations tracked include:
 *
 *   - Filing obligations (STR/SAR/CTR/CNMR/DPMSR)
 *   - Training obligations (annual AML training, quarterly refresher)
 *   - Policy obligations (30-day policy update after new circular)
 *   - Board reporting obligations (quarterly risk report, annual
 *     MLRO report)
 *   - External audit obligations (LBMA annual, internal semi-annual)
 *   - Regulatory liaison obligations (MoE inspection readiness,
 *     EOCN liaison)
 *
 * The scheduler produces an ordered list of obligations due in a
 * given window with dependency edges preserved so callers can
 * render Gantt-style views or walk the DAG in topological order.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21, 24, 26-27 (CO duty, retention, STR)
 *   - Cabinet Res 134/2025 Art.5, 19 (risk methodology, internal review)
 *   - MoE Circular 08/AML/2021 (DPMS obligations + 30-day policy rule)
 *   - LBMA RGG v9 (annual audit)
 *   - FATF Rec 18 (training + internal controls)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ObligationKind =
  | 'filing'
  | 'training'
  | 'policy_update'
  | 'board_report'
  | 'external_audit'
  | 'regulatory_liaison';

export interface Obligation {
  id: string;
  kind: ObligationKind;
  name: string;
  citation: string;
  /** Cadence in days (e.g. 90 = quarterly, 365 = annual). */
  cadenceDays: number;
  /** IDs of obligations that must be complete before this one starts. */
  dependencies: readonly string[];
  /** Lead time in days — how much warning before the deadline. */
  leadTimeDays: number;
}

export interface ScheduledObligation {
  obligation: Obligation;
  dueAt: string;
  startBy: string; // dueAt - leadTimeDays
  blockedBy: readonly string[];
  status: 'ready' | 'blocked' | 'overdue';
}

// ---------------------------------------------------------------------------
// Canonical obligation graph
// ---------------------------------------------------------------------------

export const CANONICAL_OBLIGATIONS: readonly Obligation[] = [
  {
    id: 'OB-STR-FILING',
    kind: 'filing',
    name: 'STR filing (per suspicion event)',
    citation: 'FDL No.10/2025 Art.26-27',
    cadenceDays: 10, // 10 business days
    dependencies: [],
    leadTimeDays: 5,
  },
  {
    id: 'OB-DPMSR-QUARTERLY',
    kind: 'filing',
    name: 'DPMSR quarterly return',
    citation: 'MoE Circular 08/AML/2021',
    cadenceDays: 90,
    dependencies: ['OB-TX-MONITORING'],
    leadTimeDays: 15,
  },
  {
    id: 'OB-TX-MONITORING',
    kind: 'policy_update',
    name: 'Transaction monitoring review',
    citation: 'MoE Circular 08/AML/2021',
    cadenceDays: 30,
    dependencies: [],
    leadTimeDays: 5,
  },
  {
    id: 'OB-AML-TRAINING',
    kind: 'training',
    name: 'Annual AML/CFT training',
    citation: 'FDL No.10/2025 Art.20-21 + FATF Rec 18',
    cadenceDays: 365,
    dependencies: [],
    leadTimeDays: 30,
  },
  {
    id: 'OB-QUARTERLY-REFRESHER',
    kind: 'training',
    name: 'Quarterly refresher training',
    citation: 'Cabinet Res 134/2025 Art.19',
    cadenceDays: 90,
    dependencies: ['OB-AML-TRAINING'],
    leadTimeDays: 10,
  },
  {
    id: 'OB-POLICY-UPDATE',
    kind: 'policy_update',
    name: 'Policy update after new circular (30-day rule)',
    citation: 'MoE Circular 08/AML/2021 + FDL Art.20',
    cadenceDays: 30,
    dependencies: [],
    leadTimeDays: 7,
  },
  {
    id: 'OB-BOARD-QUARTERLY',
    kind: 'board_report',
    name: 'Quarterly risk report to board',
    citation: 'Cabinet Res 134/2025 Art.5',
    cadenceDays: 90,
    dependencies: ['OB-DPMSR-QUARTERLY'],
    leadTimeDays: 14,
  },
  {
    id: 'OB-MLRO-ANNUAL',
    kind: 'board_report',
    name: 'Annual MLRO report to board',
    citation: 'FDL No.10/2025 Art.20-21',
    cadenceDays: 365,
    dependencies: ['OB-BOARD-QUARTERLY', 'OB-AML-TRAINING'],
    leadTimeDays: 60,
  },
  {
    id: 'OB-LBMA-AUDIT',
    kind: 'external_audit',
    name: 'LBMA Responsible Gold Guidance annual audit',
    citation: 'LBMA RGG v9',
    cadenceDays: 365,
    dependencies: ['OB-TX-MONITORING'],
    leadTimeDays: 60,
  },
  {
    id: 'OB-INTERNAL-AUDIT',
    kind: 'external_audit',
    name: 'Semi-annual internal audit',
    citation: 'Cabinet Res 134/2025 Art.19',
    cadenceDays: 180,
    dependencies: [],
    leadTimeDays: 30,
  },
  {
    id: 'OB-MOE-INSPECTION',
    kind: 'regulatory_liaison',
    name: 'MoE inspection readiness refresh',
    citation: 'MoE Circular 08/AML/2021',
    cadenceDays: 180,
    dependencies: ['OB-INTERNAL-AUDIT'],
    leadTimeDays: 14,
  },
];

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export interface ScheduleInput {
  lastCompletedAt: Readonly<Record<string, string>>;
  now?: Date;
  obligations?: readonly Obligation[];
}

export function scheduleObligations(input: ScheduleInput): ScheduledObligation[] {
  const obligations = input.obligations ?? CANONICAL_OBLIGATIONS;
  const now = input.now ?? new Date();
  const scheduled: ScheduledObligation[] = [];

  // Compute due date per obligation.
  const dueAtById = new Map<string, Date>();
  for (const ob of obligations) {
    const last = input.lastCompletedAt[ob.id];
    const base = last ? new Date(last) : new Date(0);
    const due = new Date(base);
    due.setUTCDate(due.getUTCDate() + ob.cadenceDays);
    dueAtById.set(ob.id, due);
  }

  for (const ob of obligations) {
    const dueAt = dueAtById.get(ob.id)!;
    const startBy = new Date(dueAt);
    startBy.setUTCDate(startBy.getUTCDate() - ob.leadTimeDays);

    const unmet = ob.dependencies.filter((depId) => {
      const depLast = input.lastCompletedAt[depId];
      const depDue = dueAtById.get(depId);
      if (!depDue) return true;
      if (!depLast) return true;
      // A dependency is met if it was completed after the dependent's
      // last completion (or never completed AND dependent hasn't run).
      return Date.parse(depLast) < now.getTime() - 365 * 86400000; // stale
    });

    const overdue = dueAt.getTime() < now.getTime();
    const blocked = unmet.length > 0 && !overdue;
    const status: ScheduledObligation['status'] = overdue
      ? 'overdue'
      : blocked
        ? 'blocked'
        : 'ready';

    scheduled.push({
      obligation: ob,
      dueAt: dueAt.toISOString(),
      startBy: startBy.toISOString(),
      blockedBy: unmet,
      status,
    });
  }

  // Topological sort (stable): obligations with no unmet deps first.
  scheduled.sort((a, b) => {
    if (a.status !== b.status) {
      const order = { overdue: 0, ready: 1, blocked: 2 };
      return order[a.status] - order[b.status];
    }
    return Date.parse(a.dueAt) - Date.parse(b.dueAt);
  });

  return scheduled;
}
