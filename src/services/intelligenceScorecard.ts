/**
 * Intelligence Scorecard — self-reporting per-decision intelligence /
 * smart / autonomous score, computed from structured inputs about
 * which subsystems fired, whether the advisor was invoked, which
 * explainability layers produced output, and whether any Tier C
 * gate was crossed.
 *
 * Why this exists:
 *   Regulators and board members routinely ask "how smart is the
 *   brain?". The answer today is a hand-waved "80+ subsystems with
 *   Bayesian reasoning" — which satisfies nobody.
 *
 *   This module produces a DEFENSIBLE per-decision score on three
 *   axes:
 *     - Intelligent: reasoning capability invoked (Bayesian, causal,
 *       debate, counterfactual, advisor, etc.)
 *     - Smart:       decision quality + explainability delivered
 *       (power score, conformal bounds, citations, reasoning chain)
 *     - Autonomous:  extent to which the decision was dispatched
 *       without human intervention — CAPPED at 80% because anything
 *       higher would break Tier C
 *
 *   Each axis is in [0, 100] so a board-level report can cite the
 *   numbers with confidence.
 *
 *   Pure function. Same structured input → same scorecard.
 *
 * Regulatory basis:
 *   EU AI Act Art.13         (transparency — self-reporting)
 *   EU AI Act Art.15         (accuracy + robustness measurement)
 *   NIST AI RMF 1.0 MEASURE-2 (quantitative AI risk measurement)
 *   NIST AI RMF 1.0 GOVERN-3 (oversight via self-scoring)
 *   ISO/IEC 42001           (AI management system scoring)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IntelligenceInput {
  /** Number of subsystems fired for this decision. */
  subsystemsFired: number;
  /** Total subsystems available (denominator). */
  totalSubsystems: number;
  /** Did Bayesian belief updater run? */
  bayesianInvoked: boolean;
  /** Did the causal engine run? */
  causalInvoked: boolean;
  /** Did the adversarial debate fire? */
  debateInvoked: boolean;
  /** Did the counterfactual explainer produce output? */
  counterfactualInvoked: boolean;
  /** Did the advisor strategy fire (Sonnet ↔ Opus)? */
  advisorInvoked: boolean;
  /** Did the graph risk scorer produce output? */
  graphRiskInvoked: boolean;
  /** Did the multi-jurisdiction engine fire? */
  multiJurisdictionInvoked: boolean;
  /** Did the feedback loop contribute to the weights used? */
  feedbackLoopActive: boolean;
}

export interface SmartInput {
  /** Brain power score 0-100. */
  powerScore: number;
  /** Confidence in [0, 1]. */
  confidence: number;
  /** Did the conformal prediction interval produce a bounded estimate? */
  conformalBounded: boolean;
  /** Did the regulatory drift watchdog run? */
  driftChecked: boolean;
  /** Did the reasoning chain produce a non-empty audit? */
  reasoningChainNonEmpty: boolean;
  /** Did the explainable scoring (SHAP-lite) produce output? */
  explainableScoring: boolean;
  /** Count of regulatory citations inlined. */
  citationsCount: number;
  /** Did the four-eyes gate fire? */
  fourEyesActive: boolean;
  /** Did the tipping-off linter run? */
  tippingOffLinted: boolean;
}

export interface AutonomousInput {
  /** Was the decision dispatched to Asana without manual click? */
  autoDispatched: boolean;
  /** Was an auto-remediation step executed? */
  autoRemediated: boolean;
  /** Was the case re-screened against a sanctions delta without human? */
  autoReScreened: boolean;
  /** Was the decision produced inside a scheduled cron? */
  producedByCron: boolean;
  /** Did any alert fire + deliver without manual ack? */
  alertAutoDelivered: boolean;
  /**
   * Hard Tier-C ceiling — the sum of (constants mutated + customer
   * message sent + four-eyes bypassed). Should always be zero.
   * Non-zero clamps the autonomy score to 0.
   */
  tierCViolations: number;
}

export interface IntelligenceScorecard {
  schemaVersion: 1;
  /** Intelligence score in [0, 100]. */
  intelligent: number;
  /** Smart (quality + explainability) score in [0, 100]. */
  smart: number;
  /** Autonomous score in [0, 100]. Hard-capped at 80. */
  autonomous: number;
  /** Composite = (intelligent + smart + autonomous) / 3. */
  composite: number;
  /** Per-axis breakdowns for auditors. */
  breakdown: {
    intelligent: ReadonlyArray<{ label: string; points: number; max: number }>;
    smart: ReadonlyArray<{ label: string; points: number; max: number }>;
    autonomous: ReadonlyArray<{ label: string; points: number; max: number }>;
  };
  /** Plain-English summary safe for the board digest. */
  summary: string;
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Hard ceiling on the autonomy score. Going higher would require
 * breaking Tier C (auto-mutate constants, auto-send customer msg,
 * bypass four-eyes) and is therefore illegal under:
 *   - FDL Art.29 (no tipping off)
 *   - Cabinet Res 134/2025 Art.12-14 (four-eyes)
 *   - regulatory envelope of src/domain/constants.ts
 */
export const AUTONOMY_CEILING = 80;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreIntelligence(input: IntelligenceInput): {
  score: number;
  breakdown: IntelligenceScorecard['breakdown']['intelligent'];
} {
  const breakdown: { label: string; points: number; max: number }[] = [];
  // Coverage: subsystems fired / total (max 30)
  const coveragePoints =
    input.totalSubsystems > 0
      ? Math.round((input.subsystemsFired / input.totalSubsystems) * 30)
      : 0;
  breakdown.push({
    label: 'Subsystem coverage',
    points: coveragePoints,
    max: 30,
  });
  // Reasoning layers (10 each)
  const layers: [string, boolean][] = [
    ['Bayesian belief updater', input.bayesianInvoked],
    ['Causal engine', input.causalInvoked],
    ['Adversarial debate', input.debateInvoked],
    ['Counterfactual explainer', input.counterfactualInvoked],
    ['Advisor strategy (Sonnet↔Opus)', input.advisorInvoked],
    ['Graph risk scorer', input.graphRiskInvoked],
    ['Multi-jurisdiction engine', input.multiJurisdictionInvoked],
  ];
  for (const [label, active] of layers) {
    breakdown.push({ label, points: active ? 9 : 0, max: 9 });
  }
  // Feedback loop active (7)
  breakdown.push({
    label: 'Feedback loop weights applied',
    points: input.feedbackLoopActive ? 7 : 0,
    max: 7,
  });
  const score = Math.min(
    100,
    breakdown.reduce((a, b) => a + b.points, 0)
  );
  return { score, breakdown };
}

function scoreSmart(input: SmartInput): {
  score: number;
  breakdown: IntelligenceScorecard['breakdown']['smart'];
} {
  const breakdown: { label: string; points: number; max: number }[] = [];
  // Power score component (max 25)
  const powerPoints = Math.round((input.powerScore / 100) * 25);
  breakdown.push({ label: 'Brain power score', points: powerPoints, max: 25 });
  // Confidence (max 10)
  breakdown.push({
    label: 'Decision confidence',
    points: Math.round(input.confidence * 10),
    max: 10,
  });
  // Bounded intervals (max 15)
  breakdown.push({
    label: 'Conformal prediction bounded',
    points: input.conformalBounded ? 15 : 0,
    max: 15,
  });
  // Drift check (max 10)
  breakdown.push({
    label: 'Regulatory drift checked',
    points: input.driftChecked ? 10 : 0,
    max: 10,
  });
  // Reasoning chain (max 10)
  breakdown.push({
    label: 'Reasoning chain non-empty',
    points: input.reasoningChainNonEmpty ? 10 : 0,
    max: 10,
  });
  // Explainable scoring (max 10)
  breakdown.push({
    label: 'Explainable scoring produced',
    points: input.explainableScoring ? 10 : 0,
    max: 10,
  });
  // Citations (max 10)
  breakdown.push({
    label: 'Regulatory citations inlined',
    points: Math.min(10, input.citationsCount * 2),
    max: 10,
  });
  // Four-eyes (max 5)
  breakdown.push({
    label: 'Four-eyes gate active',
    points: input.fourEyesActive ? 5 : 0,
    max: 5,
  });
  // Tipping-off lint (max 5)
  breakdown.push({
    label: 'Tipping-off lint run',
    points: input.tippingOffLinted ? 5 : 0,
    max: 5,
  });
  const score = Math.min(
    100,
    breakdown.reduce((a, b) => a + b.points, 0)
  );
  return { score, breakdown };
}

function scoreAutonomous(input: AutonomousInput): {
  score: number;
  breakdown: IntelligenceScorecard['breakdown']['autonomous'];
} {
  // Tier C violation is a hard kill switch.
  if (input.tierCViolations > 0) {
    return {
      score: 0,
      breakdown: [
        {
          label: 'Tier C violation detected — autonomy zeroed',
          points: 0,
          max: AUTONOMY_CEILING,
        },
      ],
    };
  }
  const breakdown: { label: string; points: number; max: number }[] = [];
  breakdown.push({
    label: 'Auto-dispatched to Asana',
    points: input.autoDispatched ? 20 : 0,
    max: 20,
  });
  breakdown.push({
    label: 'Auto-remediation executed',
    points: input.autoRemediated ? 15 : 0,
    max: 15,
  });
  breakdown.push({
    label: 'Auto re-screened against delta',
    points: input.autoReScreened ? 15 : 0,
    max: 15,
  });
  breakdown.push({
    label: 'Produced by scheduled cron',
    points: input.producedByCron ? 15 : 0,
    max: 15,
  });
  breakdown.push({
    label: 'Alerts auto-delivered',
    points: input.alertAutoDelivered ? 15 : 0,
    max: 15,
  });
  const raw = breakdown.reduce((a, b) => a + b.points, 0);
  const score = Math.min(AUTONOMY_CEILING, raw);
  return { score, breakdown };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildIntelligenceScorecard(
  intelligence: IntelligenceInput,
  smart: SmartInput,
  autonomous: AutonomousInput
): IntelligenceScorecard {
  const i = scoreIntelligence(intelligence);
  const s = scoreSmart(smart);
  const a = scoreAutonomous(autonomous);
  const composite = Math.round((i.score + s.score + a.score) / 3);
  return {
    schemaVersion: 1,
    intelligent: i.score,
    smart: s.score,
    autonomous: a.score,
    composite,
    breakdown: {
      intelligent: i.breakdown,
      smart: s.breakdown,
      autonomous: a.breakdown,
    },
    summary:
      `Intelligence scorecard: ${i.score}% intelligent / ${s.score}% smart / ` +
      `${a.score}% autonomous (composite ${composite}%). Autonomy is hard-capped ` +
      `at ${AUTONOMY_CEILING}% — going higher would break Tier C (FDL Art.29, ` +
      `Cabinet Res 134/2025 Art.12-14).`,
    regulatory: [
      'EU AI Act Art.13',
      'EU AI Act Art.15',
      'NIST AI RMF 1.0 MEASURE-2',
      'NIST AI RMF 1.0 GOVERN-3',
      'ISO/IEC 42001',
      'FDL No.10/2025 Art.29',
      'Cabinet Res 134/2025 Art.12-14',
    ],
  };
}
