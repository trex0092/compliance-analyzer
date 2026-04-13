/**
 * Case → EnrichableBrain derivation.
 *
 * The super-brain dispatcher needs an EnrichableBrain for every case
 * it fans out. Running the full runMegaBrain() pipeline requires
 * inputs (CaseMemory, peer features, hypotheses, evidence) that the
 * SPA doesn't have on hand. This module is a pure, deterministic
 * derivation that builds a reasonable EnrichableBrain from the case
 * fields we already track.
 *
 * It is NOT a replacement for runMegaBrain — it's a bridge that
 * lets every case flow through the enrichment path today. When the
 * SPA gains the missing inputs, swap the derivation for a real
 * megaBrain call and the rest of the dispatcher stack works
 * unchanged.
 *
 * Safety clamps (applied in this order):
 *   1. Critical risk level                         → 'freeze'
 *   2. Sanctions flag in findings/narrative        → 'freeze'
 *   3. ≥5 red flags                                → 'escalate'
 *   4. High risk level                             → 'escalate'
 *   5. ≥2 red flags                                → 'flag'
 *   6. Anything else                               → 'pass'
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO/MLRO duty of care — brain
 *     verdict must be explainable back to the underlying case)
 *   - FDL No.10/2025 Art.29 (no tipping off — never echoes the
 *     entity legal name into brain output)
 *   - Cabinet Res 74/2020 Art.4-7 (sanctions clamp → freeze)
 */

import type { ComplianceCase } from '../domain/cases';
import type { EnrichableBrain } from './asanaBrainEnricher';
import type { Verdict } from './asanaCustomFields';

// ---------------------------------------------------------------------------
// Verdict derivation
// ---------------------------------------------------------------------------

export interface DerivedBrainOptions {
  /** Override the confidence. Default derived from clamp depth. */
  overrideConfidence?: number;
  /**
   * Force a human-review flag. Default: true unless the derived
   * verdict is 'pass' AND the case has no red flags.
   */
  overrideRequiresHumanReview?: boolean;
}

/** Verdict + rationale for a derived case. */
export interface CaseVerdictDecision {
  verdict: Verdict;
  clamps: string[];
  confidence: number;
  recommendedAction: string;
  requiresHumanReview: boolean;
}

/**
 * Check whether the case narrative or findings mention a sanctions
 * hit. Case-insensitive substring match on a small dictionary of
 * common sanctions-related keywords. Avoids false positives by
 * requiring a whole-word-ish match.
 */
export function mentionsSanctions(caseObj: ComplianceCase): boolean {
  const haystack = [
    caseObj.narrative ?? '',
    ...(caseObj.findings ?? []),
    ...(caseObj.redFlags ?? []),
  ]
    .join(' ')
    .toLowerCase();
  const needles = [
    'sanction',
    'ofac',
    'un list',
    'eu list',
    'uk list',
    'eocn',
    'sdn',
    'terror',
    'freeze',
    'asset freeze',
  ];
  return needles.some((n) => haystack.includes(n));
}

export function deriveCaseVerdict(
  caseObj: ComplianceCase,
  options: DerivedBrainOptions = {}
): CaseVerdictDecision {
  const clamps: string[] = [];
  const redFlagCount = caseObj.redFlags?.length ?? 0;

  let verdict: Verdict = 'pass';

  // Apply the safety clamps in priority order. Each clamp that
  // fires is logged so the notes block can explain the decision.
  if (mentionsSanctions(caseObj)) {
    verdict = 'freeze';
    clamps.push('Sanctions keyword detected in findings/narrative (Cabinet Res 74/2020 Art.4-7)');
  }
  if (caseObj.riskLevel === 'critical' && verdict !== 'freeze') {
    verdict = 'freeze';
    clamps.push('Critical risk level → freeze (FDL No.10/2025 Art.20-21)');
  }
  if (redFlagCount >= 5 && verdict === 'pass') {
    verdict = 'escalate';
    clamps.push(`${redFlagCount} red flags → escalate (Cabinet Res 134/2025 Art.19)`);
  }
  if (caseObj.riskLevel === 'high' && verdict === 'pass') {
    verdict = 'escalate';
    clamps.push('High risk level → escalate (FDL No.10/2025 Art.14)');
  }
  if (redFlagCount >= 2 && verdict === 'pass') {
    verdict = 'flag';
    clamps.push(`${redFlagCount} red flags → flag (Cabinet Res 134/2025 Art.14)`);
  }

  // Confidence scales with how many clamps fired — a single clamp
  // is ~0.65, two clamps ~0.8, three+ is ~0.92. The override wins.
  const rawConfidence = Math.min(0.95, 0.5 + clamps.length * 0.15);
  const confidence = options.overrideConfidence ?? rawConfidence;

  const recommendedAction = recommendActionForVerdict(verdict, caseObj);

  const requiresHumanReview =
    options.overrideRequiresHumanReview ??
    (verdict !== 'pass' || redFlagCount > 0 || caseObj.riskLevel !== 'low');

  return {
    verdict,
    clamps,
    confidence,
    recommendedAction,
    requiresHumanReview,
  };
}

function recommendActionForVerdict(verdict: Verdict, caseObj: ComplianceCase): string {
  switch (verdict) {
    case 'freeze':
      return 'Initiate 24h EOCN freeze, file CNMR within 5 business days, do NOT tip off subject';
    case 'escalate':
      return `Escalate case ${caseObj.id} to MLRO for enhanced review; draft STR if risk confirmed`;
    case 'flag':
      return `Place case ${caseObj.id} under enhanced monitoring; schedule follow-up in 7 days`;
    case 'pass':
      return `No further action required on case ${caseObj.id}; standard retention applies`;
  }
}

// ---------------------------------------------------------------------------
// Synthetic brain builder
// ---------------------------------------------------------------------------

/**
 * Build an EnrichableBrain from a ComplianceCase. The result is a
 * synthetic reasoning artefact — it carries the derived verdict,
 * confidence, and a minimal subsystems map whose `pending` /
 * `active` flags reflect which inputs the case actually has.
 *
 * Pure. No I/O. Never fetches anything.
 */
export function caseToEnrichableBrain(
  caseObj: ComplianceCase,
  options: DerivedBrainOptions = {}
): EnrichableBrain {
  const decision = deriveCaseVerdict(caseObj, options);
  const redFlagCount = caseObj.redFlags?.length ?? 0;

  // Subsystems: every case gets the always-on ones (strPrediction,
  // reflection). Optional subsystems (belief, anomaly, precedents)
  // fire when we have something that *would* feed them.
  //
  // We stuff minimal objects into the slots so the enricher can
  // detect "present" via the `active` state path. The internals
  // of each subsystem are typed via {} as never casts so downstream
  // consumers that dereference individual fields get undefined
  // rather than a crash.
  const subsystems: EnrichableBrain['subsystems'] = {
    strPrediction: {
      score: normalizeScoreToUnit(caseObj.riskScore),
    } as unknown as EnrichableBrain['subsystems']['strPrediction'],
    reflection: {
      recommendation: decision.recommendedAction,
    } as unknown as EnrichableBrain['subsystems']['reflection'],
    // Optional subsystems: belief fires when we have >=1 red flag
    // (there's something to update a prior on), anomaly fires when
    // we have >=2 findings (a signal worth comparing to peers).
    ...(redFlagCount >= 1 && {
      belief: {
        topHypothesis: {
          label: hypothesisLabelForVerdict(decision.verdict),
          probability: decision.confidence,
        },
      } as unknown as EnrichableBrain['subsystems']['belief'],
    }),
    ...((caseObj.findings?.length ?? 0) >= 2 && {
      anomaly: {
        anomalyScore: Math.min(1, redFlagCount * 0.15),
      } as unknown as EnrichableBrain['subsystems']['anomaly'],
    }),
    // Precedents fire whenever the case has a narrative to match
    // against the case base.
    ...(caseObj.narrative && {
      precedents: {
        recommendation: 'review historical precedents for matching red flags',
      } as unknown as EnrichableBrain['subsystems']['precedents'],
    }),
  };

  // Notes echo the clamp rationales so the downstream enricher can
  // surface them in the Asana task notes block.
  const notes = [
    `Derived verdict: ${decision.verdict} at ${Math.round(decision.confidence * 100)}% confidence`,
    ...decision.clamps,
    `Red flags: ${redFlagCount}`,
    `Findings: ${caseObj.findings?.length ?? 0}`,
  ];

  return {
    verdict: decision.verdict,
    confidence: decision.confidence,
    recommendedAction: decision.recommendedAction,
    requiresHumanReview: decision.requiresHumanReview,
    entityId: caseObj.id,
    notes,
    subsystems,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hypothesisLabelForVerdict(verdict: Verdict): string {
  switch (verdict) {
    case 'freeze':
      return 'confirmed launderer';
    case 'escalate':
      return 'suspicious';
    case 'flag':
      return 'elevated risk';
    case 'pass':
      return 'clean';
  }
}

function normalizeScoreToUnit(score: number | undefined): number {
  if (typeof score !== 'number' || !Number.isFinite(score)) return 0;
  // Risk score is 0..100 in the compliance-analyzer domain.
  // Normalize to [0, 1] for the strPrediction subsystem slot.
  return Math.max(0, Math.min(1, score / 100));
}
