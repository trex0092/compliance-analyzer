/**
 * AI Governance Audit Runner — runs every framework and aggregates.
 *
 * Public entry point: `runGovernanceAudit(target, evidence)`.
 *
 * This is the function the agent definition wraps. Pure: takes an
 * evidence map and returns a GovernanceAudit. No filesystem, no
 * network, no LLM. All four framework libraries run in-process.
 */

import type {
  Framework,
  FrameworkReport,
  GovernanceAudit,
  GovernanceEvidence,
  EuAiActRiskTier,
  Control,
} from './types';
import { EU_AI_ACT_CONTROLS } from './euAiAct';
import { NIST_AI_RMF_CONTROLS } from './nistAiRmf';
import { ISO_42001_CONTROLS } from './iso42001';
import { UAE_AI_GOV_CONTROLS } from './uaeAiGov';
import { assessFramework } from './assessor';

export interface RunAuditOptions {
  target: string;
  auditedBy: string;
  evidence: GovernanceEvidence;
  /**
   * Which frameworks to include. Defaults to all four. Customer audits
   * may want to restrict to a subset (e.g. "EU AI Act only").
   */
  frameworks?: readonly Framework[];
  /** Explicit EU AI Act tier. Defaults to 'high' for financial-sector AI. */
  euAiActTier?: EuAiActRiskTier;
}

const CONTROL_LIBRARIES: Record<Framework, readonly Control[]> = {
  eu_ai_act: EU_AI_ACT_CONTROLS,
  nist_ai_rmf: NIST_AI_RMF_CONTROLS,
  iso_42001: ISO_42001_CONTROLS,
  uae_ai_gov: UAE_AI_GOV_CONTROLS,
};

const ALL_FRAMEWORKS: readonly Framework[] = ['eu_ai_act', 'nist_ai_rmf', 'iso_42001', 'uae_ai_gov'];

export function runGovernanceAudit(options: RunAuditOptions): GovernanceAudit {
  const frameworks = options.frameworks ?? ALL_FRAMEWORKS;
  const reports: FrameworkReport[] = frameworks.map((f) =>
    assessFramework(f, CONTROL_LIBRARIES[f], options.evidence)
  );

  // Overall score: unweighted average of framework scores.
  const overallScore =
    reports.length === 0
      ? 0
      : Math.round(reports.reduce((acc, r) => acc + r.score, 0) / reports.length);

  // Remediation: all critical/high failures across all frameworks.
  const remediation = reports
    .flatMap((r) => r.assessments)
    .filter((a) => a.status === 'fail' && (a.severity === 'critical' || a.severity === 'high'))
    .map((a) => ({
      framework: a.framework,
      controlId: a.controlId,
      title: a.title,
      severity: a.severity,
      citation: a.citation,
    }));

  const narrative = buildAuditNarrative(options, reports, overallScore, remediation);

  return {
    auditTarget: options.target,
    auditedAt: new Date().toISOString(),
    auditedBy: options.auditedBy,
    frameworks: reports,
    euAiActTier: options.euAiActTier ?? 'high',
    overallScore,
    remediation,
    narrative,
  };
}

function buildAuditNarrative(
  options: RunAuditOptions,
  reports: readonly FrameworkReport[],
  overallScore: number,
  remediation: GovernanceAudit['remediation']
): string {
  const lines: string[] = [];
  lines.push(`AI Governance Audit — ${options.target}`);
  lines.push(`Auditor: ${options.auditedBy}`);
  lines.push(`Timestamp: ${new Date().toISOString()}`);
  lines.push(`EU AI Act tier: ${options.euAiActTier ?? 'high'}`);
  lines.push('');
  lines.push(`Overall score: ${overallScore}/100`);
  lines.push('');
  lines.push('Framework breakdown:');
  for (const r of reports) {
    const marker = r.hasCriticalFailure ? ' !!' : '';
    lines.push(`  ${r.frameworkName}: ${r.score}/100${marker}`);
    lines.push(
      `    ${r.summary.pass} pass, ${r.summary.partial} partial, ${r.summary.fail} fail, ` +
        `${r.summary.unknown} unknown, ${r.summary.not_applicable} n/a`
    );
  }
  if (remediation.length > 0) {
    lines.push('');
    lines.push(`Remediation required (${remediation.length} critical/high failure(s)):`);
    for (const r of remediation.slice(0, 10)) {
      lines.push(`  - [${r.severity.toUpperCase()}] ${r.controlId} ${r.title} (${r.citation})`);
    }
    if (remediation.length > 10) {
      lines.push(`  ... and ${remediation.length - 10} more`);
    }
  }
  return lines.join('\n');
}
