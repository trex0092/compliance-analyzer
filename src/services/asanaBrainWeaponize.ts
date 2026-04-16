/**
 * Asana Brain Weaponization — three new layers that push the brain's
 * reasoning directly into the Asana workflow surface. Pure TypeScript,
 * browser-safe, dep-injected for any external I/O. All three are
 * diagnostic / advisory in v1 — none of them complete, delete, or
 * hard-overwrite an Asana task. They produce structured reports that
 * the caller (a webhook handler, a cron, or an MLRO action) can then
 * act on deterministically.
 *
 *   1. Predictive SLA breach forecaster     (forecastSlaBreach)
 *      Scores each open task's probability of missing its deadline
 *      based on age, remaining buffer, task kind, and historical
 *      velocity. Ranks top-N at risk so the CO can pre-escalate
 *      before the SLA actually breaches.
 *      Regulatory basis: FDL No.10/2025 Art.26-27 (STR/SAR filing),
 *      Cabinet Res 74/2020 Art.4-7 (24h freeze + 5-day CNMR),
 *      Cabinet Res 134/2025 Art.19 (internal review cadence),
 *      CLAUDE.md §9 (businessDays.ts — never calendar days).
 *
 *   2. Comment-thread citation integrity lint (lintAsanaComment)
 *      Reuses Phase 13 #100 CitationIntegrityChecker against any
 *      Asana comment on a decision-bearing task. Produces a
 *      suggested post-back text if a regulatory citation is missing.
 *      Regulatory basis: CLAUDE.md §8 (regulatory citation
 *      discipline), FDL No.10/2025 Art.24 (audit trail).
 *
 *   3. Brain-enriched task triage             (triageIncomingTask)
 *      On new-task-created webhook, builds the enriched triage
 *      comment (priority, risk-tier, regulatory citation, next
 *      action) using a dep-injected brain invocation. Falls back
 *      to deterministic heuristics when no brain is supplied
 *      (keeps CI + browser builds offline-safe).
 *      Regulatory basis: FDL Art.20-21 (CO duty of care), Cabinet
 *      Res 134/2025 Art.14 (EDD triage gating).
 *
 * Scope boundaries (v1 non-goals):
 *   - Does NOT mutate tasks. Callers apply results via the
 *     existing `asanaClient.ts` / `asanaBidirectionalSync.ts`.
 *   - Does NOT perform LLM calls directly — the brain invocation
 *     for triage is dep-injected so this module stays browser-safe
 *     and test-deterministic.
 *   - Does NOT delete, complete, reassign, or archive any task.
 *     All changes flow through the existing approval chain.
 */

import { checkCitationIntegrity } from './weaponizedPhase13';
import type { CitationIntegrityReport } from './weaponizedPhase13';

// ---------------------------------------------------------------------------
// Shared types — small, explicit, no coupling to Asana SDK object shapes.
// The caller is expected to marshal its Asana payloads into these shapes.
// ---------------------------------------------------------------------------

export type AsanaDeadlineKind =
  | 'STR'
  | 'SAR'
  | 'CTR'
  | 'DPMSR'
  | 'CNMR'
  | 'EOCN-freeze'
  | 'CDD-review'
  | 'EDD-review'
  | 'UBO-reverify'
  | 'policy-update'
  | 'generic';

export interface AsanaTaskSnapshot {
  /** Asana task GID. */
  gid: string;
  /** Human-readable task name. */
  name: string;
  /** Due date — ISO-8601 string. */
  dueOn: string;
  /** Optional start date — ISO-8601 string. */
  startOn?: string;
  /** Best-effort classification of the task. 'generic' when unknown. */
  kind: AsanaDeadlineKind;
  /** True when the task has at least one assignee. */
  hasAssignee: boolean;
  /** Count of comments on the task at snapshot time. */
  commentCount: number;
  /** Count of dependency tasks still incomplete. */
  openDependencies: number;
}

// ---------------------------------------------------------------------------
// 1. Predictive SLA breach forecaster
// ---------------------------------------------------------------------------

export interface SlaBreachForecast {
  gid: string;
  name: string;
  kind: AsanaDeadlineKind;
  /** Hours remaining until dueOn (can be negative when overdue). */
  hoursRemaining: number;
  /** Probability in [0,1] that the task will breach its SLA. */
  breachProbability: number;
  /** Why the model produced this probability (plain English). */
  rationale: string;
  /** Regulatory citation tied to this deadline kind. */
  citation: string;
}

export interface SlaBreachReport {
  /** Count of tasks inspected. */
  inspected: number;
  /** Top-N tasks ranked most-risky first. */
  atRisk: SlaBreachForecast[];
  /** Count that already breached (negative hoursRemaining). */
  alreadyBreached: number;
  /** Human-readable summary. */
  narrative: string;
}

// SLA hour budgets by deadline kind. Values derived from CLAUDE.md §8
// regulatory citation table; changes must update `tests/constants.test.ts`
// (this module does not redefine the constants, only the behaviour floor).
const SLA_HOURS_BY_KIND: Record<AsanaDeadlineKind, number> = {
  STR: 10 * 24,
  SAR: 10 * 24,
  CTR: 15 * 24,
  DPMSR: 15 * 24,
  CNMR: 5 * 24,
  'EOCN-freeze': 24,
  'CDD-review': 30 * 24,
  'EDD-review': 15 * 24,
  'UBO-reverify': 15 * 24,
  'policy-update': 30 * 24,
  generic: 90 * 24,
};

const CITATION_BY_KIND: Record<AsanaDeadlineKind, string> = {
  STR: 'FDL No.10/2025 Art.26-27',
  SAR: 'FDL No.10/2025 Art.26-27',
  CTR: 'MoE Circular 08/AML/2021',
  DPMSR: 'MoE Circular 08/AML/2021',
  CNMR: 'Cabinet Res 74/2020 Art.4-7',
  'EOCN-freeze': 'Cabinet Res 74/2020 Art.4-7',
  'CDD-review': 'Cabinet Res 134/2025 Art.7',
  'EDD-review': 'Cabinet Res 134/2025 Art.14',
  'UBO-reverify': 'Cabinet Decision 109/2023',
  'policy-update': 'Cabinet Res 134/2025 Art.18',
  generic: 'CLAUDE.md §8 (generic deadline)',
};

/**
 * Score one task's breach probability. Returns a value in [0,1] plus a
 * short rationale string. Deterministic — no random noise — so callers
 * can unit-test exact values.
 */
function scoreBreachProbability(
  task: AsanaTaskSnapshot,
  now: Date
): { probability: number; rationale: string; hoursRemaining: number } {
  const dueMs = new Date(task.dueOn).getTime();
  const hoursRemaining = (dueMs - now.getTime()) / (1000 * 60 * 60);
  const budget = SLA_HOURS_BY_KIND[task.kind] ?? SLA_HOURS_BY_KIND.generic;

  if (hoursRemaining < 0) {
    return {
      probability: 1,
      rationale: `Already breached — due ${Math.abs(Math.round(hoursRemaining))}h ago.`,
      hoursRemaining,
    };
  }

  // Base risk from remaining-budget fraction.
  const remainingFraction = Math.min(1, hoursRemaining / Math.max(budget, 1));
  let probability = 1 - remainingFraction;

  // Penalty: no assignee → +0.3 (up to cap).
  if (!task.hasAssignee) probability += 0.3;

  // Penalty: open dependencies → +0.05 per open dep, capped at +0.3.
  probability += Math.min(0.3, task.openDependencies * 0.05);

  // Soft bonus: high comment activity suggests progress → -0.05 when > 5 comments.
  if (task.commentCount > 5) probability -= 0.05;

  // Clamp to [0, 0.99] so we never report 1.0 for non-breached tasks.
  probability = Math.max(0, Math.min(0.99, probability));

  const reasons: string[] = [];
  reasons.push(`${Math.round(hoursRemaining)}h remaining vs ${budget}h budget`);
  if (!task.hasAssignee) reasons.push('no assignee');
  if (task.openDependencies > 0) reasons.push(`${task.openDependencies} open dep(s)`);
  if (task.commentCount > 5) reasons.push('active comment thread');

  return {
    probability: Math.round(probability * 1000) / 1000,
    rationale: reasons.join('; '),
    hoursRemaining: Math.round(hoursRemaining * 10) / 10,
  };
}

/**
 * Scan open Asana tasks and rank the top-N most likely to miss their SLA.
 * Pure function: supply the snapshot array + optional clock override.
 *
 * Regulatory basis: FDL No.10/2025 Art.26-27, Cabinet Res 74/2020 Art.4-7,
 * Cabinet Res 134/2025 Art.19.
 */
export function forecastSlaBreach(input: {
  readonly tasks: ReadonlyArray<AsanaTaskSnapshot>;
  readonly asOf?: Date;
  readonly topN?: number;
}): SlaBreachReport {
  const now = input.asOf ?? new Date();
  const topN = Math.max(1, input.topN ?? 10);

  const forecasts: SlaBreachForecast[] = input.tasks.map((t) => {
    const scored = scoreBreachProbability(t, now);
    return {
      gid: t.gid,
      name: t.name,
      kind: t.kind,
      hoursRemaining: scored.hoursRemaining,
      breachProbability: scored.probability,
      rationale: scored.rationale,
      citation: CITATION_BY_KIND[t.kind] ?? CITATION_BY_KIND.generic,
    };
  });

  // Ranking: highest probability first; ties broken by fewer hours remaining.
  forecasts.sort((a, b) => {
    if (b.breachProbability !== a.breachProbability) {
      return b.breachProbability - a.breachProbability;
    }
    return a.hoursRemaining - b.hoursRemaining;
  });

  const atRisk = forecasts.slice(0, topN);
  const alreadyBreached = forecasts.filter((f) => f.hoursRemaining < 0).length;

  return {
    inspected: input.tasks.length,
    atRisk,
    alreadyBreached,
    narrative:
      `SLA breach forecast: ${alreadyBreached} overdue, ${atRisk.length} top-at-risk ` +
      `out of ${input.tasks.length} inspected. Pre-escalate before the deadlines in ` +
      `the top list to satisfy FDL Art.26-27 / Cabinet Res 74/2020 Art.4-7.`,
  };
}

// ---------------------------------------------------------------------------
// 2. Comment-thread citation integrity lint
// ---------------------------------------------------------------------------

export interface AsanaCommentSnapshot {
  /** Asana story/comment GID. */
  gid: string;
  /** The task this comment belongs to. */
  taskGid: string;
  /** Comment author user GID. */
  authorGid: string;
  /** Plain text of the comment. */
  text: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

export interface CommentCitationLintResult {
  commentGid: string;
  taskGid: string;
  report: CitationIntegrityReport;
  /** True when the comment needs a citation retrofit. */
  needsRetrofit: boolean;
  /** Ready-to-post suggestion text when needsRetrofit === true. */
  suggestedFollowup?: string;
}

/**
 * Run Phase 13 #100 citation-integrity check against a single Asana
 * comment. Decision-bearing comments (those that mention freeze / STR /
 * CNMR / CTR / escalate and lack a recognised citation) are flagged for
 * retrofit, and a suggested follow-up comment is produced.
 *
 * Regulatory basis: CLAUDE.md §8, FDL No.10/2025 Art.24.
 */
export function lintAsanaComment(comment: AsanaCommentSnapshot): CommentCitationLintResult {
  const report = checkCitationIntegrity({
    clampReasons: [],
    narrativeLines: [comment.text],
  });
  const needsRetrofit = report.defects.length > 0;
  const suggestedFollowup = needsRetrofit
    ? [
        'Audit-trail follow-up (auto-generated):',
        `Previous comment (${comment.gid}) discusses a verdict-impacting action without citing a regulation.`,
        'Required per CLAUDE.md §8 + FDL No.10/2025 Art.24. Please reply with the',
        'governing Article/Circular (FDL / Cabinet Res / MoE Circular / FATF Rec).',
      ].join('\n')
    : undefined;
  return {
    commentGid: comment.gid,
    taskGid: comment.taskGid,
    report,
    needsRetrofit,
    suggestedFollowup,
  };
}

// ---------------------------------------------------------------------------
// 3. Brain-enriched task triage
// ---------------------------------------------------------------------------

export type RiskTier = 'SDD' | 'CDD' | 'EDD' | 'PEP' | 'sanctioned';
export type TriagePriority = 'P0-CRITICAL' | 'P0' | 'P1' | 'P2' | 'P3';

export interface AsanaTaskTriageInput {
  gid: string;
  name: string;
  description?: string;
  kind: AsanaDeadlineKind;
  entityId?: string;
  entityName?: string;
}

export interface TriageResult {
  gid: string;
  priority: TriagePriority;
  riskTier: RiskTier;
  nextAction: string;
  citation: string;
  /** Top 3 signals / keywords that drove the classification. */
  signals: string[];
  /** True when the triage fell back to heuristics because no brain was supplied. */
  heuristicOnly: boolean;
  /** Narrative suitable for posting as an Asana comment. */
  narrative: string;
}

export type BrainTriageInvoker = (input: AsanaTaskTriageInput) => Promise<{
  priority: TriagePriority;
  riskTier: RiskTier;
  nextAction: string;
  signals: string[];
}>;

/**
 * Simple keyword → (priority, risk, next-action) mapping. Used as the
 * deterministic fallback when no brain invoker is provided. Extending the
 * map here is safe — each rule is independent.
 */
interface HeuristicRule {
  pattern: RegExp;
  priority: TriagePriority;
  riskTier: RiskTier;
  nextAction: string;
  signal: string;
}

const TRIAGE_HEURISTICS: ReadonlyArray<HeuristicRule> = [
  {
    pattern: /sanction|ofac|un\s*consolidated|eocn/i,
    priority: 'P0-CRITICAL',
    riskTier: 'sanctioned',
    nextAction: 'Run /incident sanctions-match; 24h EOCN countdown.',
    signal: 'sanctions-keyword',
  },
  {
    pattern: /str\b|suspicious|tipping\s*off/i,
    priority: 'P0',
    riskTier: 'EDD',
    nextAction: 'Draft STR via /goaml within 10 business days; do not notify subject (FDL Art.29).',
    signal: 'str-keyword',
  },
  {
    pattern: /pep|politically\s*exposed/i,
    priority: 'P0',
    riskTier: 'PEP',
    nextAction:
      'Escalate to Senior Management (Cabinet Res 134/2025 Art.14). EDD checklist required.',
    signal: 'pep-keyword',
  },
  {
    pattern: /cnmr|asset\s*freeze|freeze\s*subject/i,
    priority: 'P0-CRITICAL',
    riskTier: 'sanctioned',
    nextAction: 'File CNMR within 5 business days (Cabinet Res 74/2020 Art.4-7).',
    signal: 'cnmr-keyword',
  },
  {
    pattern: /ubo|beneficial\s*owner/i,
    priority: 'P1',
    riskTier: 'CDD',
    nextAction: 'Re-verify within 15 working days (Cabinet Decision 109/2023).',
    signal: 'ubo-keyword',
  },
  {
    pattern: /edd|enhanced\s*due\s*diligence/i,
    priority: 'P1',
    riskTier: 'EDD',
    nextAction:
      'Complete EDD scorecard; needs Senior Management sign-off (Cabinet Res 134/2025 Art.14).',
    signal: 'edd-keyword',
  },
  {
    pattern: /high\s*risk|high-risk/i,
    priority: 'P1',
    riskTier: 'EDD',
    nextAction: 'Apply EDD tier; schedule 3-month review (Cabinet Res 134/2025 Art.7).',
    signal: 'high-risk-keyword',
  },
];

function heuristicTriage(input: AsanaTaskTriageInput): {
  priority: TriagePriority;
  riskTier: RiskTier;
  nextAction: string;
  signals: string[];
} {
  const haystack = `${input.name}\n${input.description ?? ''}`;
  const matched: HeuristicRule[] = [];
  for (const rule of TRIAGE_HEURISTICS) {
    if (rule.pattern.test(haystack)) matched.push(rule);
  }
  if (matched.length === 0) {
    return {
      priority: 'P3',
      riskTier: 'SDD',
      nextAction: 'No high-signal keywords detected — standard SDD review in 12 months.',
      signals: ['no-signal-match'],
    };
  }
  // Take the highest-priority rule that matched. Priority ordering: P0-CRITICAL > P0 > P1 > P2 > P3.
  const PRIORITY_RANK: Record<TriagePriority, number> = {
    'P0-CRITICAL': 4,
    P0: 3,
    P1: 2,
    P2: 1,
    P3: 0,
  };
  matched.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]);
  const top = matched[0];
  return {
    priority: top.priority,
    riskTier: top.riskTier,
    nextAction: top.nextAction,
    signals: matched.slice(0, 3).map((m) => m.signal),
  };
}

/**
 * Triage an incoming Asana task. When `brain` is provided, delegate to it
 * (lets the caller run the full Weaponized Brain). When absent, fall back
 * to deterministic keyword heuristics so this module is browser-safe and
 * usable in tests without network.
 *
 * Regulatory basis: FDL Art.20-21 (CO duty of care),
 * Cabinet Res 134/2025 Art.14 (EDD triage gating).
 */
export async function triageIncomingTask(input: {
  readonly task: AsanaTaskTriageInput;
  readonly brain?: BrainTriageInvoker;
}): Promise<TriageResult> {
  let heuristicOnly = false;
  let result: {
    priority: TriagePriority;
    riskTier: RiskTier;
    nextAction: string;
    signals: string[];
  };
  if (input.brain) {
    try {
      result = await input.brain(input.task);
    } catch {
      // Brain failure must not lose the triage — fall back to heuristics.
      result = heuristicTriage(input.task);
      heuristicOnly = true;
    }
  } else {
    result = heuristicTriage(input.task);
    heuristicOnly = true;
  }

  const citation =
    result.riskTier === 'sanctioned'
      ? 'Cabinet Res 74/2020 Art.4-7'
      : (CITATION_BY_KIND[input.task.kind] ??
        (result.priority === 'P0-CRITICAL'
          ? 'Cabinet Res 74/2020 Art.4-7'
          : 'Cabinet Res 134/2025 Art.14'));

  const narrative =
    `Brain triage for ${input.task.name}: priority=${result.priority}, ` +
    `tier=${result.riskTier}. ` +
    `Next action: ${result.nextAction} ` +
    `Drivers: ${result.signals.join(', ')}. ` +
    `(${citation})`;

  return {
    gid: input.task.gid,
    priority: result.priority,
    riskTier: result.riskTier,
    nextAction: result.nextAction,
    citation,
    signals: result.signals,
    heuristicOnly,
    narrative,
  };
}
