/**
 * Metacognition — the brain's self-audit layer. After the deliberative
 * chain has produced a verdict and the red-team has challenged it, the
 * metacognition step asks: "How much should the MLRO trust this output?"
 *
 * Six diagnostic dimensions, each binary:
 *
 *   D1  EVIDENCE_DIVERSITY    >=3 independent identifiers carried non-zero signal?
 *   D2  INTERVAL_WIDTH        Bayesian uncertainty interval width <= 0.4?
 *   D3  HYPOTHESIS_DECISIVE   Leading hypothesis margin >= 0.15 AND lead >= 0.5?
 *   D4  EVIDENCE_RECENCY      Temporal decay multiplier >= 0.5 (evidence fresh)?
 *   D5  NOT_FRAGILE           Top counterfactual dominance < 0.7?
 *   D6  NO_ELEVATED_REDTEAM   No red-team scenario >= 0.4 plausibility?
 *
 * The metacognition score is the fraction of dimensions that pass, in
 * [0, 1]. Confidence bands:
 *
 *   >= 5/6    HIGH      — sign off as-is
 *   >= 3/6    MODERATE  — sign off with recorded caveats
 *   <  3/6   LOW       — require second MLRO eye before action
 *
 * The result includes a prioritised list of self-audit warnings the
 * MLRO must consider. Pure function — no I/O, deterministic.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20      CO must know when to trust the system
 *   FATF Rec 1                 risk-based approach — explicit uncertainty
 *   EU AI Act Art.14           meaningful human oversight
 *   NIST AI RMF Govern 4.1     risk / trust calibration
 *   ISO/IEC 42001 § 6.1.3      AI decision auditability
 */

import type { CalibratedIdentityScore } from './identityScoreBayesian';
import type { HypothesisReasoningResult } from './hypothesisReasoner';
import type { CounterfactualAnalysis } from './counterfactualReasoner';
import type { RedTeamReasoningResult } from './redTeamBrain';

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type MetaCognitionBand = 'HIGH' | 'MODERATE' | 'LOW';

export type MetaDimension =
  | 'EVIDENCE_DIVERSITY'
  | 'INTERVAL_WIDTH'
  | 'HYPOTHESIS_DECISIVE'
  | 'EVIDENCE_RECENCY'
  | 'NOT_FRAGILE'
  | 'NO_ELEVATED_REDTEAM';

export interface MetaCheckResult {
  dimension: MetaDimension;
  passed: boolean;
  observation: string;
}

export interface MetaCognitionReport {
  /** One result per dimension — always 6 entries, in the order above. */
  checks: readonly MetaCheckResult[];
  /** Fraction of dimensions passed, in [0, 1]. */
  score: number;
  /** Bucketed band. */
  band: MetaCognitionBand;
  /** Warning messages the MLRO must consider before signing off. */
  warnings: readonly string[];
  /** Signatures of passed dimensions that support the verdict. */
  supports: readonly string[];
  /** Plain-text summary for the Asana task. */
  summary: string;
}

// ---------------------------------------------------------------------------
// Inputs — passed in as a single bag so the caller does not need to
// thread multiple arguments through the chain.
// ---------------------------------------------------------------------------

export interface MetaCognitionInput {
  calibrated: CalibratedIdentityScore;
  hypotheses: HypothesisReasoningResult;
  counterfactual: CounterfactualAnalysis;
  redTeam: RedTeamReasoningResult;
  /** Temporal decay multiplier ∈ [0.05, 1]. */
  decayMultiplier: number;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function evidenceDiversity(ca: CounterfactualAnalysis): MetaCheckResult {
  const activeFeatures = ca.attributions.filter((a) => Math.abs(a.llr) > 0.01).length;
  const passed = activeFeatures >= 3;
  return {
    dimension: 'EVIDENCE_DIVERSITY',
    passed,
    observation: passed
      ? `${activeFeatures} identifiers contributed non-zero evidence`
      : `Only ${activeFeatures} identifier(s) carried signal — collect more corroboration`,
  };
}

function intervalWidth(c: CalibratedIdentityScore): MetaCheckResult {
  const width = c.interval[1] - c.interval[0];
  const passed = width <= 0.4;
  return {
    dimension: 'INTERVAL_WIDTH',
    passed,
    observation: passed
      ? `Uncertainty interval width ${(width * 100).toFixed(0)}pp — acceptable`
      : `Uncertainty interval width ${(width * 100).toFixed(0)}pp — too wide to commit`,
  };
}

function hypothesisDecisive(h: HypothesisReasoningResult): MetaCheckResult {
  const passed = h.decisive;
  return {
    dimension: 'HYPOTHESIS_DECISIVE',
    passed,
    observation: passed
      ? `Leading hypothesis is DECISIVE (${h.leading.hypothesis}, margin ${(h.leading.margin * 100).toFixed(0)}pp)`
      : `Leading hypothesis is AMBIGUOUS — margin ${(h.leading.margin * 100).toFixed(0)}pp`,
  };
}

function evidenceRecency(multiplier: number): MetaCheckResult {
  const passed = multiplier >= 0.5;
  return {
    dimension: 'EVIDENCE_RECENCY',
    passed,
    observation: passed
      ? `Decay multiplier ${multiplier.toFixed(2)} — evidence is fresh`
      : `Decay multiplier ${multiplier.toFixed(2)} — evidence is ageing, refresh from source`,
  };
}

function notFragile(ca: CounterfactualAnalysis): MetaCheckResult {
  const passed = !ca.fragile;
  return {
    dimension: 'NOT_FRAGILE',
    passed,
    observation: passed
      ? `Evidence is distributed (top feature dominance ${(ca.topDominance * 100).toFixed(0)}%)`
      : `FRAGILE — top feature carries ${(ca.topDominance * 100).toFixed(0)}% of evidence weight`,
  };
}

function noElevatedRedTeam(r: RedTeamReasoningResult): MetaCheckResult {
  const passed = r.elevated.length === 0;
  return {
    dimension: 'NO_ELEVATED_REDTEAM',
    passed,
    observation: passed
      ? 'Red-team found no elevated counter-narrative'
      : `Red-team flagged ${r.elevated.length} elevated challenge(s); top=${r.challenges[0]?.scenario}`,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function runMetaCognition(input: MetaCognitionInput): MetaCognitionReport {
  const checks: MetaCheckResult[] = [
    evidenceDiversity(input.counterfactual),
    intervalWidth(input.calibrated),
    hypothesisDecisive(input.hypotheses),
    evidenceRecency(input.decayMultiplier),
    notFragile(input.counterfactual),
    noElevatedRedTeam(input.redTeam),
  ];

  const passed = checks.filter((c) => c.passed).length;
  const score = passed / checks.length;
  const band: MetaCognitionBand = passed >= 5 ? 'HIGH' : passed >= 3 ? 'MODERATE' : 'LOW';

  const warnings: string[] = checks.filter((c) => !c.passed).map((c) => c.observation);
  const supports: string[] = checks.filter((c) => c.passed).map((c) => c.observation);

  const summary = `Meta-confidence ${band} (${passed}/${checks.length} diagnostics passed) — ${warnings.length} warning${warnings.length === 1 ? '' : 's'}, ${supports.length} support${supports.length === 1 ? '' : 's'}`;

  return { checks, score, band, warnings, supports, summary };
}
