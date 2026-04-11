/**
 * Asana Workflow Automation — Asana Phase 3 Cluster M.
 *
 * Six workflow helpers packaged in one file:
 *
 *   M1 taskDependencyGraph        — defines STR pipeline: narrative →
 *                                   grader → 4-eyes → submission → FIU
 *                                   receipt as a DAG. Asana blocks
 *                                   out-of-order closure.
 *   M2 projectTemplateBuilder     — case-folder project payload for new
 *                                   customer onboarding (sections +
 *                                   rules + custom fields).
 *   M3 rulesAsCode                — declarative Rule[] that the bootstrap
 *                                   script can turn into real Asana
 *                                   workflow rules.
 *   M4 inboxSweeper               — archive-read-and-resolved logic.
 *   M5 autoAssignRotation         — round-robin with load balancing.
 *   M6 bulkTaskMigration          — move tasks between projects.
 *
 * All six are pure functions — the actual Asana API calls live in the
 * existing asanaClient module; this file produces the payloads and
 * decisions.
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (auditable workflow + state)
 *   - FDL No.10/2025 Art.24 (retention — no tasks lost in migrations)
 *   - FATF Rec 18 (internal controls proportionate to risk)
 */

// ---------------------------------------------------------------------------
// M1 — Task dependency graph for STR pipeline
// ---------------------------------------------------------------------------

export interface TaskDependencyEdge {
  parent: string;
  blockedBy: string;
}

export const STR_PIPELINE_DEPENDENCIES: readonly TaskDependencyEdge[] = [
  { parent: 'str_grader', blockedBy: 'str_narrative_draft' },
  { parent: 'four_eyes_primary', blockedBy: 'str_grader' },
  { parent: 'four_eyes_independent', blockedBy: 'str_grader' },
  { parent: 'fiu_submission', blockedBy: 'four_eyes_primary' },
  { parent: 'fiu_submission', blockedBy: 'four_eyes_independent' },
  { parent: 'fiu_receipt', blockedBy: 'fiu_submission' },
  { parent: 'case_close', blockedBy: 'fiu_receipt' },
];

export function validateNoCycles(edges: readonly TaskDependencyEdge[]): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const list = adj.get(e.parent) ?? [];
    list.push(e.blockedBy);
    adj.set(e.parent, list);
  }
  const visited = new Set<string>();
  const stack = new Set<string>();
  const dfs = (node: string): boolean => {
    if (stack.has(node)) return false;
    if (visited.has(node)) return true;
    stack.add(node);
    for (const next of adj.get(node) ?? []) {
      if (!dfs(next)) return false;
    }
    stack.delete(node);
    visited.add(node);
    return true;
  };
  for (const n of adj.keys()) if (!dfs(n)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// M2 — Project template builder
// ---------------------------------------------------------------------------

export interface ProjectTemplate {
  name: string;
  sections: readonly string[];
  defaultCustomFieldGids: readonly string[];
}

export function buildCustomerCaseFolderTemplate(customerName: string): ProjectTemplate {
  return {
    name: `${customerName} — Compliance Case Folder`,
    sections: [
      'New / unassigned',
      'Under review',
      'Four-eyes pending',
      'MLRO decision',
      'Filed',
      'Closed',
      'Archive',
    ],
    defaultCustomFieldGids: [], // filled in by the bootstrap script from env
  };
}

// ---------------------------------------------------------------------------
// M3 — Rules as code
// ---------------------------------------------------------------------------

export interface WorkflowRule {
  id: string;
  name: string;
  trigger: { customFieldId: string; equals: string } | { section: string };
  action: 'move_to_section' | 'assign' | 'complete' | 'notify';
  target?: string;
  citation: string;
}

export const COMPLIANCE_WORKFLOW_RULES: readonly WorkflowRule[] = [
  {
    id: 'RL-01',
    name: 'Critical risk → move to MLRO decision',
    trigger: { customFieldId: 'ASANA_CF_RISK_LEVEL_GID', equals: 'critical' },
    action: 'move_to_section',
    target: 'MLRO decision',
    citation: 'Cabinet Res 134/2025 Art.14',
  },
  {
    id: 'RL-02',
    name: 'Freeze verdict → move to MLRO decision + critical notify',
    trigger: { customFieldId: 'ASANA_CF_VERDICT_GID', equals: 'freeze' },
    action: 'notify',
    target: '#compliance-alerts',
    citation: 'Cabinet Res 74/2020 Art.4-7',
  },
  {
    id: 'RL-03',
    name: 'Escalate verdict → assign to MLRO',
    trigger: { customFieldId: 'ASANA_CF_VERDICT_GID', equals: 'escalate' },
    action: 'assign',
    target: 'MLRO',
    citation: 'FDL No.10/2025 Art.20-21',
  },
];

// ---------------------------------------------------------------------------
// M4 — Inbox sweeper
// ---------------------------------------------------------------------------

export interface InboxNotification {
  id: string;
  taskGid: string;
  read: boolean;
  taskCompleted: boolean;
  ageHours: number;
}

export function sweepInbox(
  notifications: readonly InboxNotification[]
): { archive: string[]; keep: string[] } {
  const archive: string[] = [];
  const keep: string[] = [];
  for (const n of notifications) {
    // Archive if read AND task completed AND older than 24 hours.
    if (n.read && n.taskCompleted && n.ageHours >= 24) {
      archive.push(n.id);
    } else {
      keep.push(n.id);
    }
  }
  return { archive, keep };
}

// ---------------------------------------------------------------------------
// M5 — Auto-assign rotation
// ---------------------------------------------------------------------------

export interface AnalystLoad {
  analystGid: string;
  name: string;
  openTasks: number;
  dailyCapacity: number;
}

export function pickNextAssignee(analysts: readonly AnalystLoad[]): AnalystLoad | null {
  if (analysts.length === 0) return null;
  // Pick the analyst with the lowest load ratio that still has capacity.
  const withCapacity = analysts.filter((a) => a.openTasks < a.dailyCapacity);
  if (withCapacity.length === 0) return null;
  withCapacity.sort((a, b) => a.openTasks / a.dailyCapacity - b.openTasks / b.dailyCapacity);
  return withCapacity[0];
}

// ---------------------------------------------------------------------------
// M6 — Bulk task migration
// ---------------------------------------------------------------------------

export interface MigrationInput {
  taskGids: readonly string[];
  fromProject: string;
  toProject: string;
}

export interface MigrationPlan {
  totalTasks: number;
  batches: ReadonlyArray<{ taskGid: string; fromProject: string; toProject: string }>;
  citation: string;
}

export function buildMigrationPlan(input: MigrationInput): MigrationPlan {
  return {
    totalTasks: input.taskGids.length,
    batches: input.taskGids.map((taskGid) => ({
      taskGid,
      fromProject: input.fromProject,
      toProject: input.toProject,
    })),
    citation: 'FDL No.10/2025 Art.24 (retention preserved across migrations)',
  };
}
