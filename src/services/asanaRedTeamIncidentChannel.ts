/**
 * Asana Red-Team Incident Channel — F6.
 *
 * Every miss from the nightly red-team cron (a synthetic adversarial
 * case the brain failed to detect) becomes an Asana task in a
 * dedicated "Red-team misses" project so MLROs see regressions on
 * the same surface as real cases.
 *
 * Pure compute — produces the create-task payload. The cron writes
 * the persisted miss to a blob store separately; this module is the
 * shape that gets sent to Asana.
 *
 * Regulatory basis:
 *   FATF Rec 1 (continuous risk-based testing)
 *   NIST AI RMF MS-1.1 (adversarial robustness)
 *   EU AI Act Art.15 (accuracy + robustness monitoring)
 */

export interface RedTeamMissPayload {
  caseId: string;
  typology: string;
  expectedVerdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  actualVerdict: 'pass' | 'flag' | 'escalate' | 'freeze' | string;
  detectedAtIso: string;
}

export interface RedTeamAsanaTaskInput {
  name: string;
  notes: string;
  assigneeRole: 'mlro' | 'analyst';
  dueAtIso: string;
  severity: 'high' | 'critical';
}

export function buildRedTeamMissTask(miss: RedTeamMissPayload): RedTeamAsanaTaskInput {
  const dueIso = new Date(
    new Date(miss.detectedAtIso).getTime() + 48 * 60 * 60 * 1000
  ).toISOString();
  const notes =
    `Synthetic adversarial case **${miss.caseId}** misclassified.\n\n` +
    `- **Typology:** ${miss.typology}\n` +
    `- **Expected verdict:** ${miss.expectedVerdict}\n` +
    `- **Actual verdict:** ${miss.actualVerdict}\n` +
    `- **Detected at:** ${miss.detectedAtIso}\n\n` +
    `Reproduce locally via the synthetic-evasion generator with seed=42, then patch the regressed subsystem and add a golden-case test.`;
  return {
    name: `[RED-TEAM] ${miss.typology} misclassified — ${miss.caseId}`,
    notes,
    assigneeRole: 'mlro',
    dueAtIso: dueIso,
    severity: miss.expectedVerdict === 'freeze' ? 'critical' : 'high',
  };
}
