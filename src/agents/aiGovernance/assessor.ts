/**
 * AI Governance Assessor — runs a control library against evidence.
 *
 * Pure function: takes a Control[] and a GovernanceEvidence map,
 * returns a FrameworkReport. No side effects, no network calls, no
 * LLM calls. Tests run in under 10ms.
 *
 * The scoring model:
 *   - Pass: all required evidence keys are present and truthy.
 *   - Partial: at least one key is present but at least one is missing.
 *   - Unknown: no evidence keys are set in the input (treated as 0
 *     contribution, not as failure — absence of proof is not proof of
 *     absence).
 *   - Fail: all required keys are set and at least one is falsy.
 *   - Not applicable: control has no evidence keys (marker control,
 *     e.g. EU-AIA-15 prohibited practices).
 *
 * The framework score is a weighted average where:
 *   - pass   = 1.0
 *   - partial = 0.5
 *   - unknown = 0.0 (not counted in the denominator either)
 *   - n/a     = excluded
 *
 * A critical failure (severity=critical AND status=fail) flips
 * hasCriticalFailure and will surface in the overall audit's
 * remediation list.
 */

import type {
  Control,
  ControlAssessment,
  ControlStatus,
  FrameworkReport,
  Framework,
  GovernanceEvidence,
} from './types';

function assessControl(
  control: Control,
  evidence: GovernanceEvidence
): ControlAssessment {
  if (control.evidenceKeys.length === 0) {
    return {
      controlId: control.id,
      title: control.title,
      framework: control.framework,
      citation: control.citation,
      status: 'not_applicable',
      keysChecked: [],
      keysPresent: [],
      keysMissing: [],
      severity: control.severity,
      narrative: `Control ${control.id} (${control.title}) is marker-only and not applicable to the evidence scan.`,
    };
  }

  const ev = evidence as Record<string, unknown>;
  const keysSet = control.evidenceKeys.filter((k) => ev[k] !== undefined);
  const keysPresent = keysSet.filter((k) => Boolean(ev[k]));
  const keysMissing = keysSet.filter((k) => !ev[k]);

  let status: ControlStatus;
  if (keysSet.length === 0) {
    status = 'unknown';
  } else if (keysMissing.length === 0) {
    status = 'pass';
  } else if (keysPresent.length === 0) {
    status = 'fail';
  } else {
    status = 'partial';
  }

  const narrative = buildControlNarrative(control, status, keysPresent, keysMissing);

  return {
    controlId: control.id,
    title: control.title,
    framework: control.framework,
    citation: control.citation,
    status,
    keysChecked: keysSet,
    keysPresent,
    keysMissing,
    severity: control.severity,
    narrative,
  };
}

function buildControlNarrative(
  control: Control,
  status: ControlStatus,
  present: readonly string[],
  missing: readonly string[]
): string {
  switch (status) {
    case 'pass':
      return `${control.id} PASS — all required evidence present (${present.join(', ')}). ${control.citation}.`;
    case 'fail':
      return `${control.id} FAIL — missing evidence: ${missing.join(', ')}. ${control.requirement} (${control.citation}).`;
    case 'partial':
      return `${control.id} PARTIAL — present: ${present.join(', ')}; missing: ${missing.join(', ')}. ${control.citation}.`;
    case 'unknown':
      return `${control.id} UNKNOWN — evidence not provided for keys: ${control.evidenceKeys.join(', ')}. ${control.citation}.`;
    case 'not_applicable':
      return `${control.id} N/A — marker control (${control.citation}).`;
  }
}

// ---------------------------------------------------------------------------
// Framework-level runner
// ---------------------------------------------------------------------------

const FRAMEWORK_NAMES: Record<Framework, string> = {
  eu_ai_act: 'EU AI Act (Reg 2024/1689)',
  nist_ai_rmf: 'NIST AI Risk Management Framework 1.0',
  iso_42001: 'ISO/IEC 42001:2023 AIMS',
  uae_ai_gov: 'UAE AI Governance',
};

export function assessFramework(
  framework: Framework,
  controls: readonly Control[],
  evidence: GovernanceEvidence
): FrameworkReport {
  const assessments = controls.map((c) => assessControl(c, evidence));

  const summary: Record<ControlStatus, number> = {
    pass: 0,
    fail: 0,
    partial: 0,
    unknown: 0,
    not_applicable: 0,
  };
  for (const a of assessments) {
    summary[a.status] += 1;
  }

  // Score: exclude n/a, count unknown as zero contribution (not in denom).
  const scoreable = assessments.filter((a) => a.status !== 'not_applicable' && a.status !== 'unknown');
  let scoreSum = 0;
  for (const a of scoreable) {
    if (a.status === 'pass') scoreSum += 1;
    else if (a.status === 'partial') scoreSum += 0.5;
  }
  const score = scoreable.length === 0 ? 0 : Math.round((scoreSum / scoreable.length) * 100);

  const hasCriticalFailure = assessments.some(
    (a) => a.severity === 'critical' && a.status === 'fail'
  );

  const narrative =
    `${FRAMEWORK_NAMES[framework]}: ${score}/100 score. ` +
    `${summary.pass} pass, ${summary.partial} partial, ${summary.fail} fail, ` +
    `${summary.unknown} unknown, ${summary.not_applicable} n/a.` +
    (hasCriticalFailure ? ' CRITICAL control failure(s) present — remediation required.' : '');

  return {
    framework,
    frameworkName: FRAMEWORK_NAMES[framework],
    assessments,
    summary,
    score,
    hasCriticalFailure,
    narrative,
  };
}
