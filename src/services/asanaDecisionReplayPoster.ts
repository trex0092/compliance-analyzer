/**
 * Asana Decision Replay Poster — F4.
 *
 * When a freeze/escalate decision lands, post a markdown narrative
 * of the decision's clamp chain + regulatory citations as the Asana
 * task description so the assignee sees the brain's reasoning in
 * one place — without having to drill back into the SPA.
 *
 * Pure compute. No I/O. The module is intentionally decoupled from
 * the richer decisionReplay + anomalyExplainer modules (which live
 * in a parallel PR) so it can be unit-tested in isolation here. When
 * those modules land, the orchestrator can replace the narrative
 * builder with the richer version transparently.
 *
 * The input is a narrow `ReplayInput` shape that matches both the
 * full `ComplianceDecision` type and a minimal hand-crafted shape
 * the cron jobs construct without going through the decision engine.
 *
 * Regulatory basis:
 *   FDL Art.20 (CO must be able to explain every decision)
 *   EU AI Act Art.13 (transparency requirements)
 *   NIST AI RMF MAP 2.3 (decision explainability)
 */

export type ReplayVerdict = 'pass' | 'flag' | 'escalate' | 'freeze';

export interface ReplayInput {
  /** Stable identifier — surfaces in the markdown header. */
  id: string;
  /** Tenant scope. */
  tenantId: string;
  /** Final verdict. */
  verdict: ReplayVerdict;
  /** Confidence in [0, 1]. */
  confidence: number;
  /** Plain-English recommended action. */
  recommendedAction: string;
  /** Optional clamp reasons from the underlying brain. */
  clampReasons?: readonly string[];
  /** Optional subsystem failure list. */
  subsystemFailures?: readonly string[];
  /** Optional pre-computed audit narrative. */
  auditNarrative?: string;
  /** Optional four-eyes status string. */
  fourEyesStatus?: string;
  /** Optional zk-attestation summary. */
  attestation?: {
    commitHash: string;
    listName: string;
    screenedAtIso: string;
  };
}

/**
 * Extract a regulatory citation from a clamp reason. Mirrors the
 * pattern in decisionReplay.ts so the two modules stay aligned.
 */
function extractRegulatory(text: string): string | undefined {
  const m = text.match(/\(([^)]*(?:FDL|Cabinet|FATF|EOCN|MoE|Art\.)[^)]*)\)/);
  return m ? m[1] : undefined;
}

/**
 * Build a markdown task description containing the decision id +
 * verdict + every clamp reason + regulatory citations + the audit
 * narrative.
 *
 * Output is plain Markdown so it survives in any Asana plain-text
 * fallback, and so secret-scanners + log analyzers can grep it.
 */
export function buildReplayTaskNotes(input: ReplayInput): string {
  const lines: string[] = [];
  lines.push(`# Compliance decision ${input.id}`);
  lines.push('');
  lines.push(`**Verdict:** ${input.verdict}`);
  lines.push(`**Confidence:** ${input.confidence.toFixed(2)}`);
  lines.push(`**Tenant:** ${input.tenantId}`);
  lines.push(`**Recommended action:** ${input.recommendedAction}`);
  lines.push('');

  const clampReasons = input.clampReasons ?? [];
  if (clampReasons.length > 0) {
    lines.push('## Safety clamps fired');
    for (const reason of clampReasons) {
      const reg = extractRegulatory(reason);
      lines.push(`- ${reason}${reg ? ` _[${reg}]_` : ''}`);
    }
    lines.push('');
  }

  const failures = input.subsystemFailures ?? [];
  if (failures.length > 0) {
    lines.push('## Subsystem failures');
    for (const f of failures) {
      lines.push(`- \`${f}\` failed — manual review required (FDL Art.24)`);
    }
    lines.push('');
  }

  if (input.auditNarrative) {
    lines.push('## Audit narrative');
    lines.push(input.auditNarrative);
    lines.push('');
  }

  if (input.fourEyesStatus) {
    lines.push('## Four-eyes status');
    lines.push(`- Status: \`${input.fourEyesStatus}\``);
    lines.push('');
  }

  if (input.attestation) {
    lines.push('## zk-compliance attestation');
    lines.push(`- Commit hash: \`${input.attestation.commitHash.slice(0, 16)}…\``);
    lines.push(`- List name: ${input.attestation.listName}`);
    lines.push(`- Screened at: ${input.attestation.screenedAtIso}`);
    lines.push('');
  }

  lines.push(
    '_Posted automatically by the compliance brain. Do NOT contact the subject before this decision is reviewed (FDL Art.29)._'
  );

  return lines.join('\n');
}
