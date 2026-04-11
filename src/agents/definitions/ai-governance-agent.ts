/**
 * AI Governance Agent definition.
 *
 * Wraps the runGovernanceAudit() pure function in the same
 * session + MCP + audit-chain shape as the other agents (screening,
 * onboarding, incident, filing, audit). Callers invoke it via
 * ComplianceHarness.runAiGovernanceAudit().
 *
 * Two supported modes:
 *   - Self-audit: audits the compliance-analyzer itself against the
 *     four frameworks. Evidence comes from selfAudit.ts (static,
 *     versioned with the commit).
 *   - Customer audit: audits a customer's AI system. Caller provides
 *     the evidence map + optional target name. Supports the same four
 *     frameworks (or a subset) and produces the same GovernanceAudit
 *     shape.
 *
 * Regulatory basis:
 *   - EU Reg 2024/1689 Art.27 (deployer obligations)
 *   - NIST AI RMF 1.0 (Govern, Map, Measure, Manage)
 *   - ISO/IEC 42001:2023 Clause 9 (performance evaluation)
 *   - UAE AI Charter + National AI Strategy 2031
 */

import {
  runGovernanceAudit,
  SELF_AUDIT_EVIDENCE,
  extendSelfAudit,
  type GovernanceAudit,
  type GovernanceEvidence,
  type Framework,
  type EuAiActRiskTier,
} from '../aiGovernance';

export interface AiGovernanceAgentConfig {
  /** Audit mode. */
  mode: 'self' | 'customer';
  /** Target name (e.g. 'compliance-analyzer' or 'Acme Corp AI platform'). */
  target: string;
  /** Who is running the audit. */
  auditedBy: string;
  /** For customer mode: the evidence map. Ignored in self mode. */
  evidence?: GovernanceEvidence;
  /** Optional subset of frameworks. Defaults to all four. */
  frameworks?: readonly Framework[];
  /** Explicit EU AI Act tier classification. Defaults to 'high'. */
  euAiActTier?: EuAiActRiskTier;
}

export interface AiGovernanceAgentResult {
  audit: GovernanceAudit;
  /** Short markdown summary suitable for Slack / email / PR body. */
  markdownSummary: string;
}

export function runAiGovernanceAgent(
  config: AiGovernanceAgentConfig
): AiGovernanceAgentResult {
  const evidence =
    config.mode === 'self'
      ? SELF_AUDIT_EVIDENCE
      : config.evidence ?? extendSelfAudit({}); // default: empty customer overrides baseline

  const audit = runGovernanceAudit({
    target: config.target,
    auditedBy: config.auditedBy,
    evidence,
    frameworks: config.frameworks,
    euAiActTier: config.euAiActTier,
  });

  const markdownSummary = buildMarkdownSummary(audit);

  return { audit, markdownSummary };
}

function buildMarkdownSummary(audit: GovernanceAudit): string {
  const lines: string[] = [];
  lines.push(`# AI Governance Audit — ${audit.auditTarget}`);
  lines.push('');
  lines.push(`**Auditor:** ${audit.auditedBy}`);
  lines.push(`**Timestamp:** ${audit.auditedAt}`);
  lines.push(`**EU AI Act tier:** ${audit.euAiActTier}`);
  lines.push(`**Overall score:** ${audit.overallScore}/100`);
  lines.push('');
  lines.push('## Framework breakdown');
  lines.push('');
  lines.push('| Framework | Score | Pass | Partial | Fail | Unknown | Critical failure |');
  lines.push('|---|---:|---:|---:|---:|---:|:---:|');
  for (const r of audit.frameworks) {
    lines.push(
      `| ${r.frameworkName} | ${r.score} | ${r.summary.pass} | ${r.summary.partial} | ` +
        `${r.summary.fail} | ${r.summary.unknown} | ${r.hasCriticalFailure ? '⚠' : ''} |`
    );
  }
  if (audit.remediation.length > 0) {
    lines.push('');
    lines.push(`## Remediation (${audit.remediation.length} item(s))`);
    lines.push('');
    for (const r of audit.remediation.slice(0, 20)) {
      lines.push(`- **[${r.severity.toUpperCase()}] ${r.controlId}** ${r.title} — ${r.citation}`);
    }
    if (audit.remediation.length > 20) {
      lines.push(`- _...and ${audit.remediation.length - 20} more_`);
    }
  }
  return lines.join('\n');
}
