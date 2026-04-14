/**
 * Weekly Per-Customer Status Update Builder.
 *
 * Posts a status update to each customer's Asana compliance project
 * once a week so the MLRO + auditors see "this customer's compliance
 * pulse for the past 7 days" right on the project home page. Asana
 * status updates also surface in Portfolio views, so when the MLRO
 * later sets up a Compliance Operations portfolio (Tier-4 #11), the
 * status colours roll up automatically.
 *
 * This module is the PURE summarizer + payload builder. The actual
 * Asana POST happens in netlify/functions/asana-weekly-customer-status-cron.mts
 * which walks COMPANY_REGISTRY, calls listProjectTasks for each
 * customer, hands the raw task list to summarizeCustomerWeek, and
 * posts the resulting payload via the Asana status_updates endpoint.
 *
 * Status colour semantics (matches Asana's native vocabulary):
 *   - on_track      : 0 errors, 0 freezes, ≤ 1 escalate
 *   - at_risk       : 1+ escalate or 3+ errors
 *   - off_track     : 1+ freeze or 5+ errors
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO duty of care — weekly visibility)
 *   - Cabinet Res 134/2025 Art.19 (internal review cadence)
 *   - Cabinet Res 134/2025 Art.5 (risk appetite — colour signals
 *     when a customer is drifting outside the appetite envelope)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The minimal shape of an Asana task we need to summarize. Compatible
 * with what listProjectTasks returns — `tags` is added on top via
 * opt_fields=tags.name,memberships.section.name in the cron.
 */
export interface WeeklyStatusTaskInput {
  gid: string;
  name: string;
  completed: boolean;
  created_at?: string;
  modified_at?: string;
  tags?: ReadonlyArray<{ name?: string }>;
  memberships?: ReadonlyArray<{ section?: { name?: string } }>;
}

export type StatusColor = 'on_track' | 'at_risk' | 'off_track';

export interface WeeklyCustomerStatusSummary {
  customerId: string;
  customerLegalName: string;
  windowFromIso: string;
  windowToIso: string;
  totalTasks: number;
  /** Tasks created OR modified in the window. */
  activeInWindow: number;
  completedInWindow: number;
  freezeCount: number;
  escalateCount: number;
  flagCount: number;
  passCount: number;
  blockedCount: number;
  errorCount: number;
  /** Up to 5 case ids for the "needs MLRO action" highlight. */
  spotlightCases: readonly string[];
  color: StatusColor;
}

export interface BuildWeeklyStatusInput {
  customerId: string;
  customerLegalName: string;
  windowFromIso: string;
  windowToIso: string;
  tasks: readonly WeeklyStatusTaskInput[];
}

// ---------------------------------------------------------------------------
// Tag inspectors — pure helpers
// ---------------------------------------------------------------------------

function tagsContain(task: WeeklyStatusTaskInput, predicate: (label: string) => boolean): boolean {
  if (!task.tags) return false;
  for (const tag of task.tags) {
    if (tag?.name && predicate(tag.name)) return true;
  }
  return false;
}

function hasVerdictTag(task: WeeklyStatusTaskInput, verdict: string): boolean {
  return tagsContain(task, (label) => label === `verdict:${verdict}`);
}

function isInBlockedSection(task: WeeklyStatusTaskInput): boolean {
  if (!task.memberships) return false;
  for (const m of task.memberships) {
    const name = m?.section?.name?.toLowerCase();
    if (name && name.includes('block')) return true;
  }
  return false;
}

function isInWindow(iso: string | undefined, fromMs: number, toMs: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= fromMs && t <= toMs;
}

// ---------------------------------------------------------------------------
// Pure summarizer
// ---------------------------------------------------------------------------

/**
 * Walk a customer's task list and produce the weekly status summary.
 * Counts verdicts via task tags written by asanaCentralMlroMirror +
 * the autoDispatchListener; counts blocked-column tasks via section
 * membership; spots tasks created/modified in the rolling 7-day
 * window for the "active" metric.
 *
 * Pure — no I/O, no env reads, deterministic for a given input.
 */
export function summarizeCustomerWeek(input: BuildWeeklyStatusInput): WeeklyCustomerStatusSummary {
  const fromMs = Date.parse(input.windowFromIso);
  const toMs = Date.parse(input.windowToIso);

  let activeInWindow = 0;
  let completedInWindow = 0;
  let freezeCount = 0;
  let escalateCount = 0;
  let flagCount = 0;
  let passCount = 0;
  let blockedCount = 0;
  let errorCount = 0;
  const spotlight: string[] = [];

  for (const task of input.tasks) {
    const created = isInWindow(task.created_at, fromMs, toMs);
    const modified = isInWindow(task.modified_at, fromMs, toMs);
    if (created || modified) activeInWindow++;
    if (task.completed && modified) completedInWindow++;

    if (hasVerdictTag(task, 'freeze')) {
      freezeCount++;
      if (spotlight.length < 5) spotlight.push(task.name);
    } else if (hasVerdictTag(task, 'escalate')) {
      escalateCount++;
      if (spotlight.length < 5) spotlight.push(task.name);
    } else if (hasVerdictTag(task, 'flag')) {
      flagCount++;
    } else if (hasVerdictTag(task, 'pass')) {
      passCount++;
    }

    if (isInBlockedSection(task) && !task.completed) {
      blockedCount++;
    }
    if (tagsContain(task, (l) => l === 'dispatch-error' || l === 'error')) {
      errorCount++;
    }
  }

  const color = pickStatusColor({ freezeCount, escalateCount, errorCount });

  return {
    customerId: input.customerId,
    customerLegalName: input.customerLegalName,
    windowFromIso: input.windowFromIso,
    windowToIso: input.windowToIso,
    totalTasks: input.tasks.length,
    activeInWindow,
    completedInWindow,
    freezeCount,
    escalateCount,
    flagCount,
    passCount,
    blockedCount,
    errorCount,
    spotlightCases: spotlight,
    color,
  };
}

/**
 * Map raw counts to an Asana status colour. Pure helper extracted
 * so the thresholds can be unit-tested independently.
 *
 * Colour ladder is conservative — Cabinet Res 134/2025 Art.5
 * requires risk appetite breaches to surface visibly. A single
 * freeze flips the project to off_track even if every other case
 * is clean.
 */
export function pickStatusColor(input: {
  freezeCount: number;
  escalateCount: number;
  errorCount: number;
}): StatusColor {
  if (input.freezeCount >= 1 || input.errorCount >= 5) return 'off_track';
  if (input.escalateCount >= 1 || input.errorCount >= 3) return 'at_risk';
  return 'on_track';
}

// ---------------------------------------------------------------------------
// Status update payload builder
// ---------------------------------------------------------------------------

/**
 * The shape of the request body Asana expects on
 * POST /status_updates. Modelled here so callers don't have to know
 * the wire format.
 */
export interface AsanaStatusUpdatePayload {
  data: {
    parent: string;
    title: string;
    text: string;
    status_type: StatusColor;
  };
}

function formatHumanWindow(fromIso: string, toIso: string): string {
  return `${fromIso.slice(0, 10)} → ${toIso.slice(0, 10)}`;
}

/**
 * Build the status-update body to POST against
 * `https://app.asana.com/api/1.0/status_updates`. The text is
 * Markdown-ish — Asana renders newlines and bullet lists faithfully.
 */
export function buildStatusUpdatePayload(
  summary: WeeklyCustomerStatusSummary,
  projectGid: string
): AsanaStatusUpdatePayload {
  const lines: string[] = [
    `Compliance pulse for ${summary.customerLegalName}`,
    `Window: ${formatHumanWindow(summary.windowFromIso, summary.windowToIso)}`,
    ``,
    `📊 Activity`,
    `  • Total tasks tracked: ${summary.totalTasks}`,
    `  • Active this week:    ${summary.activeInWindow}`,
    `  • Completed this week: ${summary.completedInWindow}`,
    ``,
    `🧠 Brain verdicts (this week)`,
    `  • freeze:   ${summary.freezeCount}`,
    `  • escalate: ${summary.escalateCount}`,
    `  • flag:     ${summary.flagCount}`,
    `  • pass:     ${summary.passCount}`,
    ``,
    `🚦 Operational state`,
    `  • Currently blocked: ${summary.blockedCount}`,
    `  • Dispatch errors:   ${summary.errorCount}`,
  ];

  if (summary.spotlightCases.length > 0) {
    lines.push('');
    lines.push('⚠ Cases needing MLRO attention');
    for (const c of summary.spotlightCases) {
      lines.push(`  • ${c}`);
    }
  }

  lines.push('');
  lines.push('— Auto-generated by Compliance Analyzer');
  lines.push('  FDL No.10/2025 Art.20-21 · Cabinet Res 134/2025 Art.19');

  return {
    data: {
      parent: projectGid,
      title: `Weekly compliance status — ${formatHumanWindow(summary.windowFromIso, summary.windowToIso)}`,
      text: lines.join('\n'),
      status_type: summary.color,
    },
  };
}
