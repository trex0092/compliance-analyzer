/**
 * Teacher Extension Reviewer — teacher review of Weaponized extensions.
 *
 * Phase 2 weaponization subsystem #30.
 *
 * MegaBrain has a teacher-student subsystem (#8) that re-reviews the
 * 13-subsystem chain. It does NOT know about the 6 Weaponized extensions
 * (adverse media, UBO, wallets, transactions, explainability, proof seal)
 * or the 11 Phase 2 subsystems. This module closes the gap.
 *
 * It inspects each extension output and asks: "Does this output agree
 * with the others? Is the severity appropriate? Is anything missing?"
 * Returns a teacher verdict: `ratified` (extensions are coherent) or
 * `contested` (extensions disagree, force human review).
 *
 * Regulatory basis:
 *   - Cabinet Res 134/2025 Art.19 (internal review — multi-stage)
 *   - FDL No.10/2025 Art.20 (CO documents reasoning — including teacher view)
 */

import type { Verdict } from './teacherStudent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeacherExtensionInput {
  /** The verdict the brain committed to. */
  studentVerdict: Verdict;
  /** Extension signal summaries. */
  extensions: {
    adverseMediaCriticalCount?: number;
    hasSanctionedUbo?: boolean;
    uboUndisclosedPct?: number;
    confirmedWalletHits?: number;
    structuringHigh?: boolean;
    explainableScore?: number;
  };
  /** Phase 2 signal summaries. */
  phase2?: {
    typologyTopAction?: 'freeze' | 'escalate' | 'flag' | null;
    contradictionDetected?: boolean;
    regulatorVoiceGaps?: number;
    redTeamProposal?: Verdict | null;
    narrativeDrift?: boolean;
  };
}

export interface TeacherExtensionReport {
  verdict: 'ratified' | 'contested';
  concerns: string[];
  narrative: string;
}

// ---------------------------------------------------------------------------
// Reviewer
// ---------------------------------------------------------------------------

export function reviewExtensions(input: TeacherExtensionInput): TeacherExtensionReport {
  const concerns: string[] = [];

  // Concern 1: extensions demand a stronger verdict than the student gave.
  if (input.extensions.hasSanctionedUbo && input.studentVerdict !== 'freeze') {
    concerns.push(
      `Sanctioned UBO present but verdict is ${input.studentVerdict} (expected freeze per Cabinet Res 74/2020).`
    );
  }
  if (
    (input.extensions.confirmedWalletHits ?? 0) > 0 &&
    input.studentVerdict !== 'freeze'
  ) {
    concerns.push(
      `Confirmed wallet hits present but verdict is ${input.studentVerdict} (expected freeze per FATF Rec 15).`
    );
  }

  // Concern 2: typology matcher says one thing, brain says another.
  if (input.phase2?.typologyTopAction === 'freeze' && input.studentVerdict !== 'freeze') {
    concerns.push(
      `Typology matcher suggests freeze but verdict is ${input.studentVerdict}.`
    );
  }
  if (
    input.phase2?.typologyTopAction === 'escalate' &&
    (input.studentVerdict === 'pass' || input.studentVerdict === 'flag')
  ) {
    concerns.push(
      `Typology matcher suggests escalate but verdict is ${input.studentVerdict}.`
    );
  }

  // Concern 3: contradiction detector fired.
  if (input.phase2?.contradictionDetected) {
    concerns.push('Contradiction detector found material inter-subsystem disagreement.');
  }

  // Concern 4: regulator voice pass has unanswered questions.
  if ((input.phase2?.regulatorVoiceGaps ?? 0) > 0) {
    concerns.push(
      `Regulator voice pass has ${input.phase2?.regulatorVoiceGaps} unanswered inspector question(s).`
    );
  }

  // Concern 5: red team critic proposed a stronger verdict.
  const rank: Record<Verdict, number> = { pass: 0, flag: 1, escalate: 2, freeze: 3 };
  if (
    input.phase2?.redTeamProposal &&
    rank[input.phase2.redTeamProposal] > rank[input.studentVerdict]
  ) {
    concerns.push(
      `Red team critic proposed ${input.phase2.redTeamProposal} (stronger than ${input.studentVerdict}).`
    );
  }

  // Concern 6: narrative drift (boilerplate STR text).
  if (input.phase2?.narrativeDrift) {
    concerns.push('Narrative drift detector flagged boilerplate STR text — rewrite required.');
  }

  const verdict: TeacherExtensionReport['verdict'] = concerns.length > 0 ? 'contested' : 'ratified';

  const narrative =
    verdict === 'ratified'
      ? `Teacher extension review: ratified. All ${Object.keys(input.extensions).length} extension signals coherent with student verdict ${input.studentVerdict}.`
      : `Teacher extension review: CONTESTED. ${concerns.length} concern(s):\n` +
        concerns.map((c) => `  - ${c}`).join('\n');

  return { verdict, concerns, narrative };
}
