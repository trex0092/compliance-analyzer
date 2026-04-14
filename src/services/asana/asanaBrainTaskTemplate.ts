/**
 * Asana Brain Task Template — deterministic mapper from a brain
 * response to an AsanaTaskPayload-ready structure.
 *
 * Pure function: same input → same output. Used by the Asana
 * dispatch adapter to build a task body + project routing hint +
 * tag set from a ComplianceDecision + optional power score +
 * typologies + cross-case + ensemble + velocity + regulatory drift.
 *
 * Output shape:
 *   {
 *     name:         task title (<=256 chars, severity prefix)
 *     notes:        full markdown body (<=10000 chars, tipping-off safe)
 *     projectEnvKey: which ASANA_PROJECT_* env var to route to
 *     sectionEnvKey: optional section within the project
 *     tags:         compliance-orchestrator labels for downstream filters
 *     dueDateIso:   regulatory deadline if applicable
 *   }
 *
 * The function does NOT produce Asana GIDs — that's the adapter's
 * job via env vars. This keeps the template pure and test-friendly.
 *
 * Project routing map (maps the operator's REAL Asana workspace —
 * nothing new is created, every target project already exists):
 *
 *   freeze                                   → ASANA_PROJECT_MLRO_CENTRAL
 *   critical regulatory drift (non-freeze)   → ASANA_PROJECT_AI_GOVERNANCE_WATCHDOG
 *   escalate + filing staged (STR/CTR/CNMR)  → ASANA_PROJECT_GOAML_REGULATORY_REPORTING
 *   escalate (no filing)                     → ASANA_PROJECT_KYC_CDD_TRACKER
 *   flag + SANCTIONS-* typology match        → ASANA_PROJECT_SCREENINGS_TFS_DAILY_LOG
 *   flag (general)                           → ASANA_PROJECT_COMPLIANCE_AUDIT_LOG
 *   ensemble UNSTABLE (non-freeze)           → ASANA_PROJECT_COMPLIANCE_AUDIT_LOG
 *   pass                                     → ASANA_PROJECT_COMPLIANCE_AUDIT_LOG
 *                                              (never dispatched in practice —
 *                                              brainSuperRunner skips pass verdicts —
 *                                              but returned here for defensive purity)
 *
 * Operators configure the env vars to point at their own project GIDs:
 *   ASANA_PROJECT_MLRO_CENTRAL=1234567890
 *   ASANA_PROJECT_KYC_CDD_TRACKER=0987654321
 *   ASANA_PROJECT_COMPLIANCE_AUDIT_LOG=...
 *   ASANA_PROJECT_AI_GOVERNANCE_WATCHDOG=...
 *   ASANA_PROJECT_GOAML_REGULATORY_REPORTING=...
 *   ASANA_PROJECT_SCREENINGS_TFS_DAILY_LOG=...
 *
 * Dedup invariants:
 *   - Every dispatch is idempotent via the orchestrator's
 *     <tenantId>:<verdictId> key — replays NEVER create a duplicate
 *     task in any project.
 *   - A single brain verdict is routed to EXACTLY ONE project
 *     (the first rule that fires wins; freeze beats drift beats
 *     filing beats verdict beats ensemble beats pass).
 *   - Pass verdicts never reach the dispatch adapter because
 *     brainSuperRunner short-circuits them; the routing fallback
 *     exists only so the template function remains a pure
 *     total function over its input.
 *
 * FDL Art.29 safety: the template body is built from deterministic
 * fields only. Every free-text input passes through the upstream
 * brain-analyze tipping-off linter BEFORE it reaches the template.
 * The adapter runs the final body through lintForTippingOff ONCE
 * MORE as a belt-and-braces check before calling createAsanaTask.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-21 (CO reasoned decision in audit trail)
 *   FDL No.10/2025 Art.24    (10-year retention via Asana as backup)
 *   FDL No.10/2025 Art.29    (no tipping off — deterministic body)
 *   Cabinet Res 74/2020 Art.4-7 (freeze routing → MLRO Central)
 *   Cabinet Res 134/2025 Art.14, Art.19 (four-eyes + internal review)
 *   NIST AI RMF 1.0 MANAGE-2 (AI decision provenance via drift routing)
 */

import type { ComplianceDecision } from '../complianceDecisionEngine';
import type { TypologyReport } from '../fatfTypologyMatcher';
import type { CorrelationReport } from '../crossCasePatternCorrelator';
import type { BrainPowerScore } from '../brainSuperRunner';
import type { EnsembleReport } from '../brainConsensusEnsemble';
import type { VelocityReport } from '../behaviouralVelocityDetector';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Env-key references for project + section. The adapter resolves
 * them to real GIDs at dispatch time by reading process.env.
 */
export type ProjectEnvKey =
  | 'ASANA_PROJECT_MLRO_CENTRAL'
  | 'ASANA_PROJECT_KYC_CDD_TRACKER'
  | 'ASANA_PROJECT_COMPLIANCE_AUDIT_LOG'
  | 'ASANA_PROJECT_AI_GOVERNANCE_WATCHDOG'
  | 'ASANA_PROJECT_GOAML_REGULATORY_REPORTING'
  | 'ASANA_PROJECT_SCREENINGS_TFS_DAILY_LOG';

export interface AsanaBrainTaskTemplate {
  /** Short task title with a severity prefix. */
  name: string;
  /** Full markdown body for the task notes field. */
  notes: string;
  /** Env var name the adapter resolves to an Asana project GID. */
  projectEnvKey: ProjectEnvKey;
  /** Optional section env key (not yet wired by the adapter). */
  sectionEnvKey?: string;
  /** Compliance-orchestrator labels mirrored into notes. */
  tags: readonly string[];
  /** Optional regulatory deadline as ISO date (YYYY-MM-DD). */
  dueDateIso?: string;
  /** Routing reason — used by the adapter for logging. */
  routingReason: string;
}

export interface TemplateInput {
  decision: ComplianceDecision;
  powerScore?: BrainPowerScore | null;
  typologies?: TypologyReport | null;
  crossCase?: CorrelationReport | null;
  ensemble?: EnsembleReport | null;
  velocity?: VelocityReport | null;
  regulatoryDrift?: {
    clean: boolean;
    versionDrifted: boolean;
    topSeverity: string;
    findings?: ReadonlyArray<{ key: string; severity: string }>;
  } | null;
}

// ---------------------------------------------------------------------------
// Routing — project + section per verdict (and escalations)
// ---------------------------------------------------------------------------

/**
 * Does the typology report contain a sanctions / TFS-flavoured match?
 * Used by the router to distinguish flag verdicts that belong in the
 * TFS daily log from flag verdicts that belong in the general audit
 * log.
 */
function hasSanctionsTypology(input: TemplateInput): boolean {
  const matches = input.typologies?.matches ?? [];
  return matches.some((m) => m.typology.id.startsWith('SANCTIONS'));
}

/**
 * Does the decision have a staged regulatory filing that needs to
 * land in goAML / regulatory reporting rather than EDD?
 */
function hasStagedFiling(input: TemplateInput): boolean {
  // Decision engine already carries the fourEyes object with the
  // decisionType when a filing is staged. Check for the filing-class
  // decisionTypes explicitly.
  const f = input.decision.fourEyes;
  if (!f) return false;
  return (
    f.decisionType === 'str_filing' ||
    f.decisionType === 'high_value_transaction'
  );
}

/**
 * Decide which project env key should own this task. Ordered list:
 * the first rule that fires wins. The priority order is intentional:
 *
 *   1. freeze             — safety always wins
 *   2. critical drift     — governance failure trumps verdict routing
 *   3. escalate + filing  — filings go to goAML reporting, not EDD
 *   4. escalate           — EDD path
 *   5. flag + SANCTIONS   — TFS daily log
 *   6. ensemble unstable  — boundary case needs re-review
 *   7. flag / pass        — retention log default
 *
 * A single verdict ALWAYS routes to EXACTLY ONE project. No
 * duplication across projects.
 */
export function routeToProject(input: TemplateInput): {
  projectEnvKey: ProjectEnvKey;
  routingReason: string;
} {
  const v = input.decision.verdict;

  // 1. freeze → MLRO Central (beats every other rule).
  if (v === 'freeze') {
    return {
      projectEnvKey: 'ASANA_PROJECT_MLRO_CENTRAL',
      routingReason: 'verdict=freeze → MLRO Central (Cabinet Res 74/2020 Art.4)',
    };
  }

  // 2. critical regulatory drift (non-freeze) → AI Governance Watchdog.
  if (
    input.regulatoryDrift &&
    !input.regulatoryDrift.clean &&
    input.regulatoryDrift.topSeverity === 'critical'
  ) {
    return {
      projectEnvKey: 'ASANA_PROJECT_AI_GOVERNANCE_WATCHDOG',
      routingReason:
        'critical regulatory drift → AI Governance Watchdog (NIST AI RMF MANAGE-2)',
    };
  }

  // 3. escalate with a staged filing → goAML / Regulatory Reporting.
  if (v === 'escalate' && hasStagedFiling(input)) {
    return {
      projectEnvKey: 'ASANA_PROJECT_GOAML_REGULATORY_REPORTING',
      routingReason:
        'verdict=escalate + filing staged → goAML / Regulatory Reporting (FDL Art.26-27)',
    };
  }

  // 4. escalate (no filing) → KYC/CDD Tracker (EDD path).
  if (v === 'escalate') {
    return {
      projectEnvKey: 'ASANA_PROJECT_KYC_CDD_TRACKER',
      routingReason:
        'verdict=escalate → KYC/CDD Tracker (Cabinet Res 134/2025 Art.14 — EDD)',
    };
  }

  // 5. flag with a sanctions/TFS typology match → TFS Daily Log.
  if (v === 'flag' && hasSanctionsTypology(input)) {
    return {
      projectEnvKey: 'ASANA_PROJECT_SCREENINGS_TFS_DAILY_LOG',
      routingReason:
        'verdict=flag + SANCTIONS-* typology → Screenings TFS Daily Log (FDL Art.35)',
    };
  }

  // 6. ensemble UNSTABLE → Compliance Audit Log (boundary review).
  if (input.ensemble && input.ensemble.unstable) {
    return {
      projectEnvKey: 'ASANA_PROJECT_COMPLIANCE_AUDIT_LOG',
      routingReason:
        'ensemble UNSTABLE → Compliance Audit Log (boundary case requires MLRO re-review)',
    };
  }

  // 7. flag and pass → Compliance Audit Log (FDL Art.24 retention).
  return {
    projectEnvKey: 'ASANA_PROJECT_COMPLIANCE_AUDIT_LOG',
    routingReason: `verdict=${v} → Compliance Audit Log (FDL No.10/2025 Art.24 retention)`,
  };
}

// ---------------------------------------------------------------------------
// Title + body builders
// ---------------------------------------------------------------------------

function severityPrefix(verdict: ComplianceDecision['verdict']): string {
  switch (verdict) {
    case 'freeze':
      return '🚨 FREEZE';
    case 'escalate':
      return '⚠ ESCALATE';
    case 'flag':
      return '🟡 FLAG';
    case 'pass':
      return '✅ PASS';
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function buildTitle(decision: ComplianceDecision): string {
  const prefix = severityPrefix(decision.verdict);
  // Opaque ref only — the entity name field can be ANY label the
  // operator set upstream; we do not re-lint it here because the
  // adapter will run the final body through the linter.
  const entity = decision.warRoomEvent.entityId ?? decision.id;
  const title = `${prefix} · ${entity} · ${decision.recommendedAction}`;
  return truncate(title, 256);
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function buildBody(input: TemplateInput): string {
  const { decision, powerScore, typologies, crossCase, ensemble, velocity, regulatoryDrift } = input;
  const lines: string[] = [];

  lines.push('# Brain Decision');
  lines.push('');
  lines.push(`- **Verdict:** ${decision.verdict}`);
  lines.push(`- **Confidence:** ${fmtPct(decision.confidence)}`);
  lines.push(`- **Human review required:** ${decision.requiresHumanReview ? 'YES' : 'no'}`);
  lines.push(`- **Decision id:** ${decision.id}`);
  lines.push(`- **Tenant:** ${decision.tenantId}`);
  lines.push(`- **At:** ${decision.at}`);
  lines.push('');
  lines.push(`**Recommended action:** ${decision.recommendedAction}`);
  lines.push('');
  lines.push(`**Audit narrative:** ${decision.auditNarrative}`);
  lines.push('');

  if (powerScore) {
    lines.push('## Brain Power Score');
    lines.push(
      `- ${powerScore.score}/100 · verdict **${powerScore.verdict}** · ${powerScore.subsystemsInvoked} subsystems invoked`
    );
    if (powerScore.advisorInvoked) lines.push('- 🎓 advisor escalation fired');
    if (powerScore.attestationSealed) lines.push('- 🔒 zk-attestation sealed');
    if (powerScore.clampsFired > 0)
      lines.push(`- ⚠ ${powerScore.clampsFired} safety clamp(s) fired`);
    lines.push('');
  }

  if (ensemble) {
    lines.push('## Consensus Ensemble');
    lines.push(
      `- ${ensemble.unstable ? '**UNSTABLE**' : 'stable'} — ` +
        `${ensemble.majorityVoteCount}/${ensemble.runs} runs agree (agreement ${fmtPct(ensemble.agreement)})`
    );
    lines.push(`- Majority typology: \`${ensemble.majorityTypologyId ?? 'no-match'}\``);
    lines.push(`- Majority severity: ${ensemble.majoritySeverity}`);
    lines.push('');
  }

  if (typologies && typologies.matches.length > 0) {
    lines.push('## FATF Typology Matches');
    const top = typologies.matches.slice(0, 5);
    for (const m of top) {
      lines.push(
        `- **[${m.typology.severity.toUpperCase()}] ${m.typology.id}** — ${m.typology.name} (score ${fmtPct(m.score)})`
      );
      lines.push(`  - ${m.typology.regulatory}`);
      lines.push(`  - Action: ${m.typology.recommendedAction}`);
    }
    lines.push('');
  }

  if (crossCase && crossCase.correlations.length > 0) {
    lines.push('## Cross-Case Findings');
    for (const c of crossCase.correlations.slice(0, 5)) {
      lines.push(
        `- **[${c.severity.toUpperCase()}] ${c.kind}** — ${c.caseIds.length} cases, ${fmtPct(c.confidence)} confidence`
      );
      lines.push(`  - ${c.regulatory}`);
    }
    lines.push('');
  }

  if (velocity && velocity.severity !== 'info') {
    lines.push('## Behavioural Velocity');
    lines.push(
      `- **${velocity.severity.toUpperCase()}** composite ${fmtPct(velocity.compositeScore)} across ${velocity.caseCount} cases`
    );
    lines.push(
      `  - Burst ${fmtPct(velocity.burst.score)} · Off-hours ${fmtPct(velocity.offHours.score)} · Weekend ${fmtPct(velocity.weekend.score)}`
    );
    lines.push(`- ${velocity.regulatory}`);
    lines.push('');
  }

  if (regulatoryDrift && !regulatoryDrift.clean) {
    lines.push('## ⚠ Regulatory Drift');
    lines.push(`- top severity: **${regulatoryDrift.topSeverity}**`);
    if (regulatoryDrift.versionDrifted)
      lines.push('- REGULATORY_CONSTANTS_VERSION drifted');
    if (regulatoryDrift.findings) {
      for (const f of regulatoryDrift.findings.slice(0, 5)) {
        lines.push(`- ${f.key} — ${f.severity}`);
      }
    }
    lines.push('');
  }

  if (decision.fourEyes) {
    lines.push('## Four-Eyes Gate');
    lines.push(`- **Status:** ${decision.fourEyes.status}`);
    lines.push(`- **Decision type:** ${decision.fourEyes.decisionType}`);
    lines.push(
      `- Approvals: ${decision.fourEyes.approvalCount}/${decision.fourEyes.requiredCount}`
    );
    if (decision.fourEyes.missingRoles.length > 0) {
      lines.push(`- Missing roles: ${decision.fourEyes.missingRoles.join(', ')}`);
    }
    lines.push(`- Regulatory basis: ${decision.fourEyes.regulatoryRef}`);
    lines.push('');
  }

  if (decision.attestation) {
    lines.push('## zk-Compliance Attestation');
    lines.push(`- List: ${decision.attestation.listName}`);
    lines.push(`- Commit: \`${decision.attestation.commitHash.slice(0, 32)}…\``);
    lines.push(`- Published: ${decision.attestation.attestationPublishedAtIso}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(
    '_FDL No.10/2025 Art.29 — no tipping off. Do not share this task or its contents with the subject._'
  );

  return truncate(lines.join('\n'), 10_000);
}

// ---------------------------------------------------------------------------
// Tag builder
// ---------------------------------------------------------------------------

function buildTags(input: TemplateInput): string[] {
  const tags: string[] = [`brain/verdict/${input.decision.verdict}`];
  if (input.decision.requiresHumanReview) tags.push('brain/human-review');
  if (input.powerScore) tags.push(`brain/power/${input.powerScore.verdict}`);
  if (input.ensemble?.unstable) tags.push('brain/ensemble/unstable');
  if (input.typologies && input.typologies.matches.length > 0) {
    tags.push(`brain/typology/${input.typologies.topSeverity}`);
  }
  if (input.crossCase && input.crossCase.correlations.length > 0) {
    tags.push(`brain/cross-case/${input.crossCase.topSeverity}`);
  }
  if (input.velocity && input.velocity.severity !== 'info') {
    tags.push(`brain/velocity/${input.velocity.severity}`);
  }
  if (input.regulatoryDrift && !input.regulatoryDrift.clean) {
    tags.push(`brain/drift/${input.regulatoryDrift.topSeverity}`);
  }
  if (input.decision.fourEyes) {
    tags.push('brain/four-eyes');
  }
  if (input.decision.attestation) {
    tags.push('brain/zk-sealed');
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function buildAsanaTaskFromBrainResponse(
  input: TemplateInput
): AsanaBrainTaskTemplate {
  const route = routeToProject(input);
  return {
    name: buildTitle(input.decision),
    notes: buildBody(input),
    projectEnvKey: route.projectEnvKey,
    routingReason: route.routingReason,
    tags: buildTags(input),
  };
}

// Exports for tests.
export const __test__ = {
  severityPrefix,
  truncate,
  buildTitle,
  buildBody,
  buildTags,
  hasSanctionsTypology,
  hasStagedFiling,
};
