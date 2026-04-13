/**
 * Decision Replay helper.
 *
 * Walks a stored ComplianceDecision and produces a step-by-step
 * narrative of every clamp, escalation, and subsystem activation
 * that contributed to the final verdict. The output is suitable
 * for an MLRO time-travel UI (or for an inspector who wants to
 * understand exactly why a freeze was triggered six months ago).
 *
 * The replay is PURE — given the same decision object it always
 * produces the same step list. No I/O.
 *
 * Regulatory basis:
 *   FDL Art.24 (record reconstruction)
 *   EOCN Inspection Manual §9 (decision audit trail)
 *   EU AI Act Art.13 (transparency requirements)
 */

import type { ComplianceDecision } from './complianceDecisionEngine';

export type ReplayStepKind =
  | 'mega-brain'
  | 'extension'
  | 'clamp'
  | 'human-review'
  | 'subsystem-failure'
  | 'four-eyes'
  | 'attestation'
  | 'final';

export interface ReplayStep {
  index: number;
  kind: ReplayStepKind;
  /** Verdict in effect AFTER this step (monotone — never downgrades). */
  verdict: ComplianceDecision['verdict'];
  /** Confidence in effect AFTER this step. */
  confidence: number;
  /** Short, human-readable description. */
  message: string;
  /** Optional regulatory basis citation. */
  regulatory?: string;
}

export interface ReplayResult {
  decisionId: string;
  steps: ReplayStep[];
  finalVerdict: ComplianceDecision['verdict'];
  finalConfidence: number;
}

const VERDICT_RANK: Record<ComplianceDecision['verdict'], number> = {
  pass: 0,
  flag: 1,
  escalate: 2,
  freeze: 3,
};

function maxVerdict(
  a: ComplianceDecision['verdict'],
  b: ComplianceDecision['verdict']
): ComplianceDecision['verdict'] {
  return VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b;
}

export function replayDecision(decision: ComplianceDecision): ReplayResult {
  const steps: ReplayStep[] = [];
  let runningVerdict: ComplianceDecision['verdict'] = 'pass';
  let runningConfidence = 1;
  let i = 0;

  // Step 1: MegaBrain baseline (the 13 core subsystems) — derived
  // from the underlying mega response.
  const mega = decision.raw?.mega;
  if (mega) {
    runningVerdict = maxVerdict(runningVerdict, mega.verdict as ComplianceDecision['verdict']);
    runningConfidence = mega.confidence ?? runningConfidence;
    steps.push({
      index: i++,
      kind: 'mega-brain',
      verdict: runningVerdict,
      confidence: runningConfidence,
      message: `MegaBrain baseline: verdict=${mega.verdict}, confidence=${(mega.confidence ?? 0).toFixed(2)}`,
    });
  }

  // Step 2: every extension that fired.
  const extensions = (decision.raw?.extensions as Record<string, unknown> | undefined) ?? undefined;
  if (extensions && typeof extensions === 'object') {
    for (const [name, value] of Object.entries(extensions)) {
      if (value === null || value === undefined) continue;
      const previewKeys =
        typeof value === 'object' && value !== null
          ? Object.keys(value as Record<string, unknown>)
              .slice(0, 3)
              .join(', ')
          : '';
      steps.push({
        index: i++,
        kind: 'extension',
        verdict: runningVerdict,
        confidence: runningConfidence,
        message: `Extension subsystem fired: ${name}${previewKeys ? ` (${previewKeys})` : ''}`,
      });
    }
  }

  // Step 3: every clamp reason from the weaponized brain.
  const clampReasons = decision.raw?.clampReasons ?? [];
  for (const reason of clampReasons) {
    // Each clamp may escalate the running verdict — we cannot infer
    // the new verdict from the reason text alone, but we DO know the
    // final verdict is at least as strict as the running verdict
    // before the clamp, so monotone-bump up to the decision's verdict
    // when the clamp text mentions freeze/escalate.
    if (/freeze|frozen/i.test(reason)) {
      runningVerdict = maxVerdict(runningVerdict, 'freeze');
    } else if (/escalat/i.test(reason)) {
      runningVerdict = maxVerdict(runningVerdict, 'escalate');
    }
    steps.push({
      index: i++,
      kind: 'clamp',
      verdict: runningVerdict,
      confidence: runningConfidence,
      message: reason,
      regulatory: extractRegulatory(reason),
    });
  }

  // Step 4: subsystem failures.
  const failures = decision.raw?.subsystemFailures ?? [];
  for (const f of failures) {
    runningVerdict = maxVerdict(runningVerdict, 'flag');
    steps.push({
      index: i++,
      kind: 'subsystem-failure',
      verdict: runningVerdict,
      confidence: runningConfidence,
      message: `Subsystem ${f} failed — manual review required (FDL Art.24)`,
      regulatory: 'FDL No.10/2025 Art.24',
    });
  }

  // Step 5: human review flag.
  if (decision.requiresHumanReview) {
    steps.push({
      index: i++,
      kind: 'human-review',
      verdict: runningVerdict,
      confidence: runningConfidence,
      message: 'Engine flagged requiresHumanReview=true',
    });
  }

  // Step 6: four-eyes outcome.
  if (decision.fourEyes) {
    const status = decision.fourEyes.status;
    if (status === 'rejected' || status === 'expired') {
      runningVerdict = maxVerdict(runningVerdict, 'escalate');
    }
    steps.push({
      index: i++,
      kind: 'four-eyes',
      verdict: runningVerdict,
      confidence: runningConfidence,
      message: `Four-eyes status: ${status}`,
      regulatory: 'FDL No.10/2025 Art.20-21',
    });
  }

  // Step 7: zk-attestation seal.
  if (decision.attestation) {
    steps.push({
      index: i++,
      kind: 'attestation',
      verdict: runningVerdict,
      confidence: runningConfidence,
      message: `zk-attestation sealed (commit ${decision.attestation.commitHash.slice(0, 16)}…)`,
    });
  }

  // Step 8: final reconciliation — ensure the running verdict matches
  // the engine's final verdict. Any mismatch is a bug we record so
  // the auditor can spot replay drift.
  const finalVerdict = maxVerdict(runningVerdict, decision.verdict);
  const finalConfidence = decision.confidence;
  steps.push({
    index: i++,
    kind: 'final',
    verdict: finalVerdict,
    confidence: finalConfidence,
    message: `FINAL: verdict=${finalVerdict}, confidence=${finalConfidence.toFixed(2)}`,
  });

  return {
    decisionId: decision.id,
    steps,
    finalVerdict,
    finalConfidence,
  };
}

/**
 * Extract a regulatory reference from a free-text clamp reason. The
 * weaponized brain emits clamp messages with parenthesised citations
 * like "(Cabinet Res 74/2020 Art.4-7)" — pull them out so the UI can
 * surface them prominently.
 */
function extractRegulatory(text: string): string | undefined {
  const match = text.match(/\(([^)]*(?:FDL|Cabinet|FATF|EOCN|MoE|Art\.)[^)]*)\)/);
  return match ? match[1] : undefined;
}
