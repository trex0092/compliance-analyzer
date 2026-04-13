/**
 * Asana Policy Change Tracker — F9.
 *
 * When the regulatory drift watcher detects a new circular, this
 * helper produces the create-task payload for an Asana "Policy
 * Update" task with the `/regulatory-update` skill checklist as
 * subtasks.
 *
 * Pure compute. The orchestrator translates the result into one
 * parent task + N subtasks via asanaClient.
 *
 * Regulatory basis:
 *   CLAUDE.md "30 days: Policy update deadline after new MoE circular"
 *   FDL Art.19 (internal review)
 */

export interface PolicyChangePayload {
  /** Source authority — MoE / EOCN / CBUAE / FATF / etc. */
  authority: string;
  /** Headline of the new circular. */
  headline: string;
  /** Public URL where the circular is published. */
  url: string;
  /** ISO timestamp the drift watcher detected the change. */
  detectedAtIso: string;
  /** Optional pre-extracted scope text. */
  scope?: string;
}

export interface PolicyChangeAsanaSubtask {
  id: string;
  name: string;
  notes: string;
  dueInHours: number;
}

export interface PolicyChangeAsanaPlan {
  parentName: string;
  parentNotes: string;
  parentDueAtIso: string;
  subtasks: readonly PolicyChangeAsanaSubtask[];
}

const POLICY_UPDATE_CHECKLIST: readonly Omit<PolicyChangeAsanaSubtask, 'notes'>[] = [
  { id: 'read', name: 'Read full circular', dueInHours: 24 },
  { id: 'extract_obligations', name: 'Extract concrete obligations', dueInHours: 48 },
  { id: 'gap_analysis', name: 'Gap analysis vs current controls', dueInHours: 96 },
  { id: 'update_constants', name: 'Update src/domain/constants.ts if needed', dueInHours: 7 * 24 },
  { id: 'update_skills', name: 'Update affected /skills/ files', dueInHours: 14 * 24 },
  { id: 'update_training', name: 'Update MLRO training materials', dueInHours: 21 * 24 },
  { id: 'staff_brief', name: 'Brief compliance staff', dueInHours: 25 * 24 },
  { id: 'audit_trace', name: 'Document the policy-update trace for auditors', dueInHours: 28 * 24 },
];

export function buildPolicyChangePlan(payload: PolicyChangePayload): PolicyChangeAsanaPlan {
  const detectedMs = new Date(payload.detectedAtIso).getTime();
  const parentDueAtIso = new Date(detectedMs + 30 * 24 * 60 * 60 * 1000).toISOString();
  const parentNotes =
    `**Authority:** ${payload.authority}\n` +
    `**Headline:** ${payload.headline}\n` +
    `**Source URL:** ${payload.url}\n` +
    `**Detected at:** ${payload.detectedAtIso}\n\n` +
    `${payload.scope ? '**Scope:** ' + payload.scope + '\n\n' : ''}` +
    `Per CLAUDE.md, all internal policy updates must be in place within 30 days of the circular's publication.`;
  const subtasks: PolicyChangeAsanaSubtask[] = POLICY_UPDATE_CHECKLIST.map((entry) => ({
    ...entry,
    notes: `Task: ${entry.name}. Mark complete only after evidence is captured in the audit chain.`,
  }));
  return {
    parentName: `[POLICY] ${payload.authority}: ${payload.headline}`,
    parentNotes,
    parentDueAtIso,
    subtasks,
  };
}
