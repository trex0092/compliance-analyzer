/**
 * Priority Scorer — Tier B2.
 *
 * Ranks a list of cases so the batch dispatcher processes the
 * highest-impact ones first. Score formula:
 *
 *   score = riskWeight(riskLevel) * 10
 *         + redFlagCount * 2
 *         + criticalityBoost (sanctions keyword: +20, pep: +10)
 *         + timeUrgency (days until filing deadline — more
 *           urgent = higher score)
 *
 * Pure. Works on any Case-shaped input with riskLevel + redFlags.
 *
 * Regulatory basis:
 *   - Cabinet Res 74/2020 Art.4-7 (24h freeze — time-critical cases
 *     must surface first)
 *   - FDL No.10/2025 Art.26-27 (STR without delay)
 *   - Cabinet Res 134/2025 Art.14 (PEP/EDD prioritization)
 */

import type { ComplianceCase, RiskLevel } from '../domain/cases';
import { mentionsSanctions } from './caseToEnrichableBrain';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PriorityScore {
  caseId: string;
  score: number;
  /** Component breakdown for audit + explainability. */
  components: {
    risk: number;
    redFlags: number;
    criticality: number;
    urgency: number;
  };
  /** ISO deadline used for the urgency component. */
  deadlineIso?: string;
}

export interface PriorityOptions {
  /** ISO "now" for deterministic tests. */
  nowIso?: string;
  /** Optional deadline resolver — case id → deadline ISO. */
  deadlineResolver?: (caseId: string) => string | undefined;
}

// ---------------------------------------------------------------------------
// Component scorers
// ---------------------------------------------------------------------------

const RISK_WEIGHTS: Record<RiskLevel, number> = {
  low: 1,
  medium: 3,
  high: 7,
  critical: 10,
};

function scoreRisk(level: RiskLevel): number {
  return RISK_WEIGHTS[level] * 10;
}

function scoreRedFlags(caseObj: ComplianceCase): number {
  return (caseObj.redFlags?.length ?? 0) * 2;
}

function scoreCriticality(caseObj: ComplianceCase): number {
  let score = 0;
  if (mentionsSanctions(caseObj)) score += 20;
  const text = `${caseObj.narrative ?? ''} ${(caseObj.findings ?? []).join(' ')}`.toLowerCase();
  if (text.includes('pep')) score += 10;
  if (text.includes('ubo change')) score += 5;
  if (text.includes('cross-border')) score += 3;
  return score;
}

function scoreUrgency(deadlineIso: string | undefined, nowIso: string): number {
  if (!deadlineIso) return 0;
  const deadline = Date.parse(deadlineIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(deadline) || !Number.isFinite(now)) return 0;
  const hoursUntil = (deadline - now) / 3_600_000;
  if (hoursUntil <= 0) return 50; // already overdue — maximum urgency
  if (hoursUntil <= 24) return 30;
  if (hoursUntil <= 72) return 15;
  if (hoursUntil <= 7 * 24) return 8;
  return 0;
}

// ---------------------------------------------------------------------------
// Pure scorer
// ---------------------------------------------------------------------------

export function scoreCase(caseObj: ComplianceCase, options: PriorityOptions = {}): PriorityScore {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const deadlineIso = options.deadlineResolver?.(caseObj.id);

  const components = {
    risk: scoreRisk(caseObj.riskLevel),
    redFlags: scoreRedFlags(caseObj),
    criticality: scoreCriticality(caseObj),
    urgency: scoreUrgency(deadlineIso, nowIso),
  };

  const score = components.risk + components.redFlags + components.criticality + components.urgency;

  return {
    caseId: caseObj.id,
    score,
    components,
    deadlineIso,
  };
}

/**
 * Sort an array of cases by descending priority score. Pure — the
 * input is not mutated. Ties broken by case id for stability.
 */
export function sortCasesByPriority(
  cases: readonly ComplianceCase[],
  options: PriorityOptions = {}
): ComplianceCase[] {
  const scored = cases.map((c) => ({ case: c, score: scoreCase(c, options) }));
  scored.sort((a, b) => {
    if (a.score.score !== b.score.score) return b.score.score - a.score.score;
    return a.case.id.localeCompare(b.case.id);
  });
  return scored.map((s) => s.case);
}
