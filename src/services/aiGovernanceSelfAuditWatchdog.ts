/**
 * AI Governance Self-Audit Watchdog — Tier E4.
 *
 * Runs `runAiGovernanceAgent('self')` on a schedule and compares
 * the overall score against a configured floor. When the score
 * drops below the floor, the watchdog emits a critical-severity
 * TaskPayload that the caller (cron or SPA autopilot) posts into
 * the governance Asana project.
 *
 * Pure decision layer + thin dispatcher. Tests exercise the
 * decision table across every branch (floor, critical failure,
 * remediation gating).
 *
 * Regulatory basis:
 *   - NIST AI RMF 1.0 GOVERN-1 + MANAGE-4 (continuous AI system
 *     governance review)
 *   - ISO/IEC 42001:2023 Clause 9.1 (performance evaluation)
 *   - EU Reg 2024/1689 Art.17 (post-market monitoring)
 *   - UAE AI Charter + National AI Strategy 2031
 */

import type { GovernanceAudit } from '../agents/aiGovernance/types';
import type { AsanaTaskPayload } from './asanaClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SelfAuditSeverity = 'ok' | 'watch' | 'warn' | 'critical';

export interface SelfAuditDecisionInput {
  audit: GovernanceAudit;
  /** Minimum acceptable overall score. Default 80. */
  scoreFloor?: number;
  /** Score that triggers "watch" tier. Default 90. */
  watchFloor?: number;
  /** Score that triggers "warn" tier. Default 85. */
  warnFloor?: number;
  /** Optional ISO "now" for deterministic tests. */
  nowIso?: string;
}

export interface SelfAuditDecision {
  severity: SelfAuditSeverity;
  shouldOpenTask: boolean;
  overallScore: number;
  scoreFloor: number;
  hasCriticalFailure: boolean;
  topRemediation: Array<{
    controlId: string;
    title: string;
    severity: string;
    citation: string;
  }>;
  rationale: string;
}

// ---------------------------------------------------------------------------
// Pure decision layer
// ---------------------------------------------------------------------------

/**
 * Classify the governance audit into an action tier. Pure —
 * given the same audit + thresholds, always returns the same
 * decision. Callers use `shouldOpenTask` to decide whether to
 * escalate to Asana.
 */
export function decideSelfAuditAction(input: SelfAuditDecisionInput): SelfAuditDecision {
  const scoreFloor = input.scoreFloor ?? 80;
  const warnFloor = input.warnFloor ?? 85;
  const watchFloor = input.watchFloor ?? 90;
  const { audit } = input;

  const hasCriticalFailure = audit.frameworks.some((f) => f.hasCriticalFailure);

  let severity: SelfAuditSeverity;
  if (hasCriticalFailure || audit.overallScore < scoreFloor) {
    severity = 'critical';
  } else if (audit.overallScore < warnFloor) {
    severity = 'warn';
  } else if (audit.overallScore < watchFloor) {
    severity = 'watch';
  } else {
    severity = 'ok';
  }

  const shouldOpenTask = severity === 'critical' || severity === 'warn';

  const topRemediation = audit.remediation.slice(0, 5).map((r) => ({
    controlId: r.controlId,
    title: r.title,
    severity: r.severity,
    citation: r.citation,
  }));

  const rationale = buildRationale(severity, audit.overallScore, scoreFloor, hasCriticalFailure);

  return {
    severity,
    shouldOpenTask,
    overallScore: audit.overallScore,
    scoreFloor,
    hasCriticalFailure,
    topRemediation,
    rationale,
  };
}

function buildRationale(
  severity: SelfAuditSeverity,
  score: number,
  floor: number,
  criticalFailure: boolean
): string {
  if (severity === 'ok') {
    return `Governance score ${score} meets or exceeds the watch threshold. No action required.`;
  }
  if (criticalFailure) {
    return `Governance score ${score} — one or more frameworks reported a critical failure. Escalation mandatory (NIST AI RMF MANAGE-4).`;
  }
  if (severity === 'critical') {
    return `Governance score ${score} is below the mandatory floor of ${floor}. Immediate remediation required (ISO/IEC 42001:2023 Clause 9.1).`;
  }
  if (severity === 'warn') {
    return `Governance score ${score} is below the warning threshold but still above the floor. Open a remediation task within 5 business days.`;
  }
  return `Governance score ${score} is drifting toward the warn threshold. Monitor on the next audit tick.`;
}

// ---------------------------------------------------------------------------
// Task payload builder
// ---------------------------------------------------------------------------

export interface GovernanceTaskPayloadInput {
  decision: SelfAuditDecision;
  audit: GovernanceAudit;
  projectGid: string;
  /** Assignee gid for the remediation owner. */
  assigneeGid?: string;
}

/**
 * Build an Asana task payload from a governance self-audit
 * decision. Caller calls createAsanaTask / createStrLifecycleTasks
 * / the dispatcher of their choice.
 */
export function buildGovernanceTaskPayload(input: GovernanceTaskPayloadInput): AsanaTaskPayload {
  const { decision, audit, projectGid, assigneeGid } = input;
  const severityIcon: Record<SelfAuditSeverity, string> = {
    ok: 'GREEN',
    watch: 'YELLOW',
    warn: 'ORANGE',
    critical: 'RED',
  };
  const name = `[${severityIcon[decision.severity]}] AI Governance drift — ${audit.auditTarget} (${decision.overallScore}/100)`;

  const notes = [
    '## AI Governance Self-Audit Watchdog',
    '',
    `Target: ${audit.auditTarget}`,
    `Audited by: ${audit.auditedBy}`,
    `Audited at: ${audit.auditedAt}`,
    `Overall score: ${decision.overallScore} / 100 (floor: ${decision.scoreFloor})`,
    `Severity: ${decision.severity.toUpperCase()}`,
    `Critical failure: ${decision.hasCriticalFailure ? 'YES' : 'no'}`,
    '',
    '### Rationale',
    decision.rationale,
    '',
    '### Framework scores',
    ...audit.frameworks.map(
      (f) =>
        `- **${f.frameworkName}**: ${f.score}/100 (pass: ${f.summary.pass}, fail: ${f.summary.fail})`
    ),
    '',
    '### Top remediation',
    ...(decision.topRemediation.length > 0
      ? decision.topRemediation.map(
          (r) => `- [${r.severity.toUpperCase()}] ${r.controlId}: ${r.title} — ${r.citation}`
        )
      : ['- (no remediation items in the top 5)']),
    '',
    'Regulatory basis: NIST AI RMF 1.0 GOVERN-1, MANAGE-4; ISO/IEC 42001:2023 Clause 9.1;',
    'EU Reg 2024/1689 Art.17; UAE AI Charter.',
    '',
    'FDL Art.29 — no tipping off. This task is for internal AI governance only.',
  ].join('\n');

  return {
    name,
    notes,
    projects: [projectGid],
    assignee: assigneeGid,
    tags: ['ai-governance', 'self-audit', decision.severity],
  };
}
