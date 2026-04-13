/**
 * Asana Custom Field Router — F3.
 *
 * Maps a compliance decision onto the `ComplianceCustomFieldInput`
 * shape consumed by the existing `asanaCustomFields.ts` builder. The
 * router keeps the decision engine and the Asana custom-field schema
 * decoupled — the brain doesn't know about Asana, and the Asana layer
 * doesn't know about the brain's internal verdict shape.
 *
 * Input is a narrow `RouterDecisionInput` shape so the router stays
 * independent of the full ComplianceDecision interface (which lives
 * in a parallel PR). Any caller can satisfy this shape from a stored
 * brain event without re-running the brain.
 *
 * Pure compute. No I/O.
 *
 * Regulatory basis:
 *   FDL Art.20 (CO must be able to explain every decision)
 *   Cabinet Res 134/2025 Art.19 (auditable workflow + state)
 */

import type {
  ComplianceCustomFieldInput,
  RiskLevel,
  Verdict,
  DeadlineType,
} from './asanaCustomFields';

export interface RouterDecisionInput {
  /** Stable identifier — used as the case_id custom field. */
  id: string;
  /** Final verdict. */
  verdict: Verdict;
  /** Confidence in [0, 1]. */
  confidence: number;
  /** Optional clamp reasons — used to extract the regulatory citation. */
  clampReasons?: readonly string[];
}

export interface RouterOptions {
  /** Optional pre-computed deadline tag — e.g. 'STR' for a draft, 'EOCN' for a freeze. */
  deadlineType?: DeadlineType;
  /** Optional days remaining until the deadline. */
  daysRemaining?: number;
  /** Optional regulation citation override. */
  regulationOverride?: string;
}

function verdictToRiskLevel(verdict: Verdict): RiskLevel {
  switch (verdict) {
    case 'freeze':
      return 'critical';
    case 'escalate':
      return 'high';
    case 'flag':
      return 'medium';
    case 'pass':
    default:
      return 'low';
  }
}

function pickRegulation(input: RouterDecisionInput): string | undefined {
  for (const clamp of input.clampReasons ?? []) {
    const m = clamp.match(/\(([^)]*(?:FDL|Cabinet|FATF|EOCN|MoE|Art\.)[^)]*)\)/);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * Build the custom-field input for a single Asana task derived from
 * a compliance decision. Pass the result to
 * `buildComplianceCustomFields` from `asanaCustomFields.ts` to get
 * the shape the Asana create-task API expects.
 */
export function routeDecisionToCustomFields(
  input: RouterDecisionInput,
  options: RouterOptions = {}
): ComplianceCustomFieldInput {
  return {
    riskLevel: verdictToRiskLevel(input.verdict),
    verdict: input.verdict,
    caseId: input.id,
    deadlineType: options.deadlineType,
    daysRemaining: options.daysRemaining,
    confidence: input.confidence,
    regulationCitation: options.regulationOverride ?? pickRegulation(input),
  };
}
