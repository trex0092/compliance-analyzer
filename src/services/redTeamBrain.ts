/**
 * Red-Team Brain — adversarial counter-narrative generator.
 *
 * After the five-step deliberative brain chain has produced its
 * verdict, the red-team asks: "What is the strongest argument AGAINST
 * this conclusion?" and "What is the strongest argument FOR escalating
 * a hit the brain wanted to dismiss?"
 *
 * For each canonical adversarial scenario the red-team:
 *   1. Scores how plausible the scenario is given the CURRENT evidence
 *      (0 = implausible, 1 = strongly supported by the evidence).
 *   2. Lists the evidence points that make the scenario plausible.
 *   3. Proposes one concrete probe the MLRO can run to confirm or
 *      falsify the scenario.
 *
 * Six canonical scenarios are always evaluated so the MLRO can rely on
 * the output shape:
 *
 *   R1  COMMON_NAME_COLLISION     high-frequency name + no secondary ID
 *   R2  FAMILY_RELATIVE_EDD       same surname + nationality + DoB differs
 *   R3  STOLEN_OR_RECYCLED_ID     ID agrees but name/DoB inconsistent
 *   R4  TRANSLITERATION_COLLISION ambiguous Arabic/Latin rendering
 *   R5  SYNTHETIC_IDENTITY        partial agreement with unverified IDs
 *   R6  TIPPED_OFF_RELOCATION     subject recently amended IDs before a hit
 *
 * The red-team flags a challenge as ELEVATED when the plausibility
 * score is >= 0.40. Any ELEVATED challenge must be considered before
 * the MLRO signs off.
 *
 * Pure function — no I/O, no globals. Output is deterministic.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20      CO must consider alternative explanations
 *   FATF Rec 10                positive ID — rules out alternative hypotheses
 *   FATF Rec 1                 risk-based approach — adversarial stress test
 *   EU AI Act Art.14           meaningful human oversight
 *   NIST AI RMF Measure 2.7    counterfactual / adversarial analysis
 *   ISO/IEC 42001 § 6.1.3      AI decision auditability
 */

import type { IdentityMatchBreakdown } from './identityMatchScore';
import type { EvidenceObservations } from './identityScoreBayesian';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type RedTeamScenario =
  | 'COMMON_NAME_COLLISION'
  | 'FAMILY_RELATIVE_EDD'
  | 'STOLEN_OR_RECYCLED_ID'
  | 'TRANSLITERATION_COLLISION'
  | 'SYNTHETIC_IDENTITY'
  | 'TIPPED_OFF_RELOCATION';

export interface RedTeamChallenge {
  scenario: RedTeamScenario;
  /** Plausibility of this adversarial scenario given current evidence, in [0, 1]. */
  plausibility: number;
  /** Short description of what the scenario claims. */
  description: string;
  /** Evidence points that make this scenario more plausible. */
  supportingSignals: readonly string[];
  /** One concrete investigative probe to confirm or falsify. */
  probe: string;
  /** Regulatory citation the MLRO would invoke if this scenario resolves true. */
  regulatoryAnchor: string;
}

export interface RedTeamReasoningResult {
  challenges: readonly RedTeamChallenge[];
  /** Challenges with plausibility >= 0.40. */
  elevated: readonly RedTeamChallenge[];
  /** Highest plausibility across all scenarios, in [0, 1]. */
  maxPlausibility: number;
  /** Plain-text summary for the Asana task. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Optional signals the dispatcher can pass in to sharpen the score.
// All fields optional — the red-team must return sensible output even
// with only the breakdown + observation matrix.
// ---------------------------------------------------------------------------

export interface RedTeamContext {
  /** True when the subject name is in the portfolio's top-50 most common names. */
  isCommonName?: boolean;
  /** True when the list entry name contains Arabic or non-Latin characters. */
  hasTransliteration?: boolean;
  /** True when the subject amended identifiers within the last 30 days. */
  recentIdentifierAmendment?: boolean;
  /** Number of prior alerts on this subject in the last 90 days. */
  recentAlertCount?: number;
}

// ---------------------------------------------------------------------------
// Scoring — hand-tuned against DPMS portfolio patterns. Each scenario
// returns a raw plausibility in [0, 1]; callers treat >= 0.40 as an
// ELEVATED challenge that must be acknowledged before sign-off.
// ---------------------------------------------------------------------------

function scoreCommonNameCollision(
  breakdown: IdentityMatchBreakdown,
  obs: EvidenceObservations,
  ctx: RedTeamContext
): { score: number; signals: string[] } {
  const signals: string[] = [];
  let s = 0;
  if (breakdown.name >= 0.9) {
    s += 0.35;
    signals.push('Name matches strongly but says nothing about identity');
  }
  if (!obs.subjectHasId || !obs.hitHasId) {
    s += 0.2;
    signals.push('No corroborating ID / passport number on either side');
  }
  if (!obs.subjectHasDob || !obs.hitHasDob) {
    s += 0.15;
    signals.push('No corroborating DoB on either side');
  }
  if (ctx.isCommonName) {
    s += 0.25;
    signals.push('Subject name is in the portfolio common-names register');
  }
  // If an ID actually agreed, this scenario collapses.
  if (obs.subjectHasId && obs.hitHasId && breakdown.id >= 0.999) {
    s = Math.max(0, s - 0.5);
  }
  return { score: Math.max(0, Math.min(1, s)), signals };
}

function scoreFamilyRelative(
  breakdown: IdentityMatchBreakdown,
  obs: EvidenceObservations
): { score: number; signals: string[] } {
  const signals: string[] = [];
  let s = 0;
  if (breakdown.name >= 0.7) {
    s += 0.25;
    signals.push('Surname component overlaps — consistent with relative');
  }
  if (breakdown.nationality >= 0.999) {
    s += 0.2;
    signals.push('Same nationality as the designated entity');
  }
  if (obs.subjectHasDob && obs.hitHasDob && breakdown.dob < 0.5) {
    s += 0.3;
    signals.push('DoB differs — classic family pattern');
  }
  if (obs.subjectHasId && obs.hitHasId && breakdown.id >= 0.999) {
    // Same ID number rules out relative.
    s = Math.max(0, s - 0.6);
  }
  return { score: Math.max(0, Math.min(1, s)), signals };
}

function scoreStolenOrRecycledId(
  breakdown: IdentityMatchBreakdown,
  obs: EvidenceObservations
): { score: number; signals: string[] } {
  const signals: string[] = [];
  let s = 0;
  if (obs.subjectHasId && obs.hitHasId && breakdown.id >= 0.999) {
    s += 0.35;
    signals.push('ID agrees exactly');
  }
  if (breakdown.name < 0.7 && obs.subjectHasId && obs.hitHasId && breakdown.id >= 0.999) {
    s += 0.35;
    signals.push('Name diverges while ID matches — recycled-ID pattern');
  }
  if (obs.subjectHasDob && obs.hitHasDob && breakdown.dob < 0.5 && breakdown.id >= 0.999) {
    s += 0.25;
    signals.push('DoB differs while ID matches — recycled-ID pattern');
  }
  return { score: Math.max(0, Math.min(1, s)), signals };
}

function scoreTransliterationCollision(
  breakdown: IdentityMatchBreakdown,
  obs: EvidenceObservations,
  ctx: RedTeamContext
): { score: number; signals: string[] } {
  const signals: string[] = [];
  let s = 0;
  if (ctx.hasTransliteration) {
    s += 0.25;
    signals.push('List entry contains non-Latin characters — transliteration risk');
  }
  if (breakdown.name >= 0.7 && breakdown.name < 0.9) {
    s += 0.2;
    signals.push('Name score is in the transliteration-ambiguity band (0.7-0.9)');
  }
  if (!obs.subjectHasId || !obs.hitHasId) {
    s += 0.1;
    signals.push('No ID available to break transliteration ambiguity');
  }
  return { score: Math.max(0, Math.min(1, s)), signals };
}

function scoreSyntheticIdentity(
  breakdown: IdentityMatchBreakdown,
  obs: EvidenceObservations
): { score: number; signals: string[] } {
  const signals: string[] = [];
  let s = 0;
  const agreements = [
    breakdown.name >= 0.7,
    breakdown.dob >= 0.5,
    breakdown.nationality >= 0.999,
    breakdown.id >= 0.999,
  ].filter(Boolean).length;
  const missing = [
    !obs.subjectHasDob || !obs.hitHasDob,
    !obs.subjectHasNationality || !obs.hitHasNationality,
    !obs.subjectHasId || !obs.hitHasId,
  ].filter(Boolean).length;
  if (agreements === 1 && missing >= 2) {
    s += 0.3;
    signals.push('Only one identifier corroborates; the rest are unverifiable');
  }
  if (breakdown.id >= 0.999 && breakdown.name < 0.5) {
    s += 0.2;
    signals.push('ID agrees but name is weak — fabricated KYC profile risk');
  }
  return { score: Math.max(0, Math.min(1, s)), signals };
}

function scoreTippedOffRelocation(ctx: RedTeamContext): { score: number; signals: string[] } {
  const signals: string[] = [];
  let s = 0;
  if (ctx.recentIdentifierAmendment) {
    s += 0.35;
    signals.push('Subject amended ID fields within the last 30 days');
  }
  if ((ctx.recentAlertCount ?? 0) >= 2) {
    s += 0.15;
    signals.push('Repeat hits in the last 90 days — pattern consistent with probing');
  }
  return { score: Math.max(0, Math.min(1, s)), signals };
}

// ---------------------------------------------------------------------------
// Scenario metadata
// ---------------------------------------------------------------------------

function describe(s: RedTeamScenario): string {
  switch (s) {
    case 'COMMON_NAME_COLLISION':
      return 'Subject shares a high-frequency name with the designated entity.';
    case 'FAMILY_RELATIVE_EDD':
      return 'Subject is a relative of the designated entity — name + nationality overlap with DoB divergence.';
    case 'STOLEN_OR_RECYCLED_ID':
      return 'Identifier belongs to the designated entity but the person presenting it is not the same individual.';
    case 'TRANSLITERATION_COLLISION':
      return 'Arabic or Latin transliteration collapses two distinct names into near-duplicates.';
    case 'SYNTHETIC_IDENTITY':
      return 'A fabricated KYC profile with partial, unverifiable corroboration.';
    case 'TIPPED_OFF_RELOCATION':
      return 'Subject has recently altered identifiers — potentially evading screening (FDL Art.29 risk).';
  }
}

function probeFor(s: RedTeamScenario): string {
  switch (s) {
    case 'COMMON_NAME_COLLISION':
      return 'Collect DoB and ID / passport number; if either disagrees, dismiss with recorded rationale.';
    case 'FAMILY_RELATIVE_EDD':
      return 'Investigate family relationship — if confirmed, apply EDD per Cabinet Res 134/2025 Art.14.';
    case 'STOLEN_OR_RECYCLED_ID':
      return 'Contact the ID issuing authority to verify chain-of-custody of the identifier.';
    case 'TRANSLITERATION_COLLISION':
      return 'Re-run the subject through the Arabic-transliteration + phonetic matcher; verify against original script.';
    case 'SYNTHETIC_IDENTITY':
      return 'Trigger enhanced document verification (biometric check / source-document lookup).';
    case 'TIPPED_OFF_RELOCATION':
      return 'Review CDD audit log for identifier amendments; escalate to CO if pre-hit tampering is detected.';
  }
}

function regulatoryAnchorFor(s: RedTeamScenario): string {
  switch (s) {
    case 'COMMON_NAME_COLLISION':
      return 'FATF Rec 10 (positive identification); FDL No.10/2025 Art.20';
    case 'FAMILY_RELATIVE_EDD':
      return 'Cabinet Res 134/2025 Art.14 (PEP / EDD); FATF Rec 12';
    case 'STOLEN_OR_RECYCLED_ID':
      return 'FATF Rec 10 (positive identification); FDL No.10/2025 Art.12';
    case 'TRANSLITERATION_COLLISION':
      return 'FATF Rec 10 (positive identification); UAE EOCN TFS Guidance 2025';
    case 'SYNTHETIC_IDENTITY':
      return 'FATF Rec 10 (positive identification); FDL No.10/2025 Art.12 (CDD)';
    case 'TIPPED_OFF_RELOCATION':
      return 'FDL No.10/2025 Art.29 (no tipping off); FATF Rec 21';
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function runRedTeamBrain(
  breakdown: IdentityMatchBreakdown,
  obs: EvidenceObservations,
  ctx: RedTeamContext = {}
): RedTeamReasoningResult {
  const scorers: Record<RedTeamScenario, () => { score: number; signals: string[] }> = {
    COMMON_NAME_COLLISION: () => scoreCommonNameCollision(breakdown, obs, ctx),
    FAMILY_RELATIVE_EDD: () => scoreFamilyRelative(breakdown, obs),
    STOLEN_OR_RECYCLED_ID: () => scoreStolenOrRecycledId(breakdown, obs),
    TRANSLITERATION_COLLISION: () => scoreTransliterationCollision(breakdown, obs, ctx),
    SYNTHETIC_IDENTITY: () => scoreSyntheticIdentity(breakdown, obs),
    TIPPED_OFF_RELOCATION: () => scoreTippedOffRelocation(ctx),
  };

  const scenarios: RedTeamScenario[] = [
    'COMMON_NAME_COLLISION',
    'FAMILY_RELATIVE_EDD',
    'STOLEN_OR_RECYCLED_ID',
    'TRANSLITERATION_COLLISION',
    'SYNTHETIC_IDENTITY',
    'TIPPED_OFF_RELOCATION',
  ];

  const challenges: RedTeamChallenge[] = scenarios
    .map((s) => {
      const { score, signals } = scorers[s]();
      return {
        scenario: s,
        plausibility: score,
        description: describe(s),
        supportingSignals: signals,
        probe: probeFor(s),
        regulatoryAnchor: regulatoryAnchorFor(s),
      };
    })
    .sort((a, b) => b.plausibility - a.plausibility);

  const elevated = challenges.filter((c) => c.plausibility >= 0.4);
  const maxPlausibility = challenges[0]?.plausibility ?? 0;

  const summary = elevated.length
    ? `${elevated.length} ELEVATED adversarial challenge${elevated.length === 1 ? '' : 's'}; top=${challenges[0].scenario} @ ${(maxPlausibility * 100).toFixed(0)}%`
    : `No elevated adversarial challenges; top=${challenges[0]?.scenario ?? 'n/a'} @ ${(maxPlausibility * 100).toFixed(0)}%`;

  return { challenges, elevated, maxPlausibility, summary };
}
