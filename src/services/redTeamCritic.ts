/**
 * Red Team Critic — adversarial challenge to every high-stakes verdict.
 *
 * Phase 2 weaponization subsystem #20.
 *
 * The critic tries to construct a rebuttal to the brain's current verdict:
 *  - If verdict is `freeze` or `escalate`, the critic looks for evidence
 *    that would flip it to `pass` (e.g. "the match confidence is below the
 *    0.9 cutoff", "the UBO percentage is under 25%").
 *  - If verdict is `pass`, the critic looks for evidence that would flip
 *    it to `escalate` (e.g. "adverse media hit was ignored", "transaction
 *    velocity is above the norm").
 *
 * A successful rebuttal does NOT change the deterministic verdict — it
 * escalates to `requiresHumanReview` and produces a challenge narrative
 * the MLRO can use to sanity-check the decision. This is the compliance
 * equivalent of "adversarial robustness" for ML systems.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO duty of care — document dissenting views)
 *   - Cabinet Res 134/2025 Art.19 (internal review before decision)
 *   - FATF Rec 18 (internal controls proportionate to risk)
 */

import type { Verdict } from './teacherStudent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RedTeamInput {
  /** The current final verdict the brain has committed to. */
  verdict: Verdict;
  /** Current confidence in [0,1]. */
  confidence: number;
  /** Every clamp reason produced so far. */
  clampReasons: readonly string[];
  /** Signals available to the critic — factual facts about the case. */
  signals: {
    sanctionsMatchScore?: number;
    adverseMediaCriticalCount?: number;
    uboUndisclosedPct?: number;
    hasSanctionedUbo?: boolean;
    confirmedWalletHits?: number;
    structuringSeverity?: 'low' | 'medium' | 'high';
    isPep?: boolean;
  };
}

export interface RedTeamChallenge {
  /** The verdict the critic suggests instead. null if no successful challenge. */
  proposedVerdict: Verdict | null;
  /** The reasoning chain for the challenge. Empty if no challenge. */
  reasons: string[];
  /** Whether a material challenge was found. */
  hasChallenge: boolean;
  /** Narrative suitable for the audit trail. */
  narrative: string;
}

// ---------------------------------------------------------------------------
// Critic
// ---------------------------------------------------------------------------

/**
 * Run the red team critic against the current verdict. Returns a
 * RedTeamChallenge with proposed counter-verdict and reasoning. The
 * caller is free to ignore the proposal — this is advisory only.
 */
export function redTeamCritique(input: RedTeamInput): RedTeamChallenge {
  const reasons: string[] = [];
  let proposedVerdict: Verdict | null = null;

  if (input.verdict === 'freeze' || input.verdict === 'escalate') {
    // Adversarial mode: try to downgrade.
    if ((input.signals.sanctionsMatchScore ?? 0) < 0.5) {
      reasons.push(
        `Sanctions match score is ${input.signals.sanctionsMatchScore ?? 0} — below the 0.5 ` +
          `potential-match threshold. Consider dismissal with documentation.`
      );
    }
    if ((input.signals.uboUndisclosedPct ?? 0) <= 25 && !input.signals.hasSanctionedUbo) {
      reasons.push(
        `UBO undisclosed portion is within Cabinet Decision 109/2023 limit (25%). ` +
          `If no other red flags, EDD may be sufficient instead of freeze.`
      );
    }
    if ((input.signals.adverseMediaCriticalCount ?? 0) === 0) {
      reasons.push(
        `No critical adverse media hits. Challenge: is escalation proportionate ` +
          `to the available evidence? (Cabinet Res 134/2025 Art.14)`
      );
    }
    if (reasons.length >= 2) {
      proposedVerdict = 'flag';
    }
  } else {
    // Passive mode: try to upgrade.
    if ((input.signals.adverseMediaCriticalCount ?? 0) > 0) {
      reasons.push(
        `${input.signals.adverseMediaCriticalCount} critical adverse media hit(s) present. ` +
          `Challenge: why isn't this escalated?`
      );
      proposedVerdict = 'escalate';
    }
    if (input.signals.hasSanctionedUbo) {
      reasons.push(
        `Sanctioned UBO present. Challenge: freeze protocol should fire ` +
          `(Cabinet Res 74/2020 Art.4-7).`
      );
      proposedVerdict = 'freeze';
    }
    if ((input.signals.confirmedWalletHits ?? 0) > 0) {
      reasons.push(
        `${input.signals.confirmedWalletHits} confirmed wallet hit(s). Challenge: ` +
          `freeze protocol should fire (FATF Rec 15).`
      );
      proposedVerdict = 'freeze';
    }
    if (input.signals.structuringSeverity === 'high') {
      reasons.push(
        `High-severity structuring detected. Challenge: ` +
          `MoE Circular 08/AML/2021 requires escalation.`
      );
      if (!proposedVerdict) proposedVerdict = 'escalate';
    }
  }

  const hasChallenge = reasons.length > 0;
  const narrative = hasChallenge
    ? `Red team critic challenges the current verdict (${input.verdict}):\n` +
      reasons.map((r) => `  - ${r}`).join('\n') +
      (proposedVerdict ? `\nProposed counter-verdict: ${proposedVerdict}` : '')
    : `Red team critic found no material challenge to the current verdict (${input.verdict}).`;

  return { proposedVerdict, reasons, hasChallenge, narrative };
}
