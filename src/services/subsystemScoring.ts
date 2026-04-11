/**
 * Subsystem Scoring — 5-dimension rubric for Weaponized Brain subsystems.
 *
 * Phase 3 weaponization: closes the feedback loop so the brain improves
 * against our actual case history. Inspired by the singularity-claude
 * rubric (correctness, completeness, edge cases, efficiency, reusability)
 * but scoped tightly for compliance:
 *
 *   - Scoring runs OVER DATA, not code. A subsystem's score is computed
 *     from historical outputs + MLRO overrides; the code itself never
 *     changes automatically.
 *
 *   - Low scores DO NOT trigger auto-repair of regulatory logic. Instead
 *     they open an Asana task for human review via the openRepairTask()
 *     hook. This is the non-negotiable safety line: MoE inspection
 *     defensibility requires that every change to compliance logic
 *     passes through a human.
 *
 *   - Crystallization (singularity-claude terminology) is a git tag —
 *     a subsystem that holds >= 90 for 5 runs gets tagged and frozen.
 *
 * Regulatory basis:
 *   - FDL No.10/2025 Art.20-21 (CO duty of care — documented learning)
 *   - Cabinet Res 134/2025 Art.19 (internal review before policy change)
 */

// ---------------------------------------------------------------------------
// Rubric types
// ---------------------------------------------------------------------------

export interface RubricScore {
  /** Correctness: did the verdict agree with MLRO outcome? [0,20]. */
  correctness: number;
  /** Completeness: did all required fields populate? [0,20]. */
  completeness: number;
  /** Edge cases: handled unusual inputs without failure? [0,20]. */
  edgeCases: number;
  /** Efficiency: low wall-clock / no retries? [0,20]. */
  efficiency: number;
  /** Reusability: did the output feed downstream correctly? [0,20]. */
  reusability: number;
}

export interface SubsystemRun {
  /** Subsystem name (e.g. 'redTeamCritic', 'typologies'). */
  subsystem: string;
  /** ISO timestamp of the run. */
  at: string;
  /** Brain verdict for this run. */
  verdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  /** Eventual MLRO override, if any. */
  mlroOverride?: 'pass' | 'flag' | 'escalate' | 'freeze';
  /** Whether the subsystem threw during execution. */
  failed: boolean;
  /** Whether all optional fields the subsystem can populate were populated. */
  complete: boolean;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Whether downstream subsystems consumed this output successfully. */
  consumed: boolean;
}

export interface SubsystemScoreReport {
  subsystem: string;
  rubric: RubricScore;
  /** Sum of the five dimensions. Range [0,100]. */
  total: number;
  /** Number of runs included in this score. */
  runCount: number;
  /** Maturity state, mirrors singularity-claude. */
  maturity: 'draft' | 'tested' | 'hardened' | 'crystallized';
  /** Suggested action if the score is low. */
  recommendation: 'crystallize' | 'ratify' | 'monitor' | 'open_repair_task';
  /** Narrative summary for the audit file. */
  narrative: string;
}

// ---------------------------------------------------------------------------
// Thresholds — configurable per deployment.
// ---------------------------------------------------------------------------

export interface ScoringConfig {
  autoRepairThreshold: number;
  crystallizationThreshold: number;
  crystallizationMinExecutions: number;
  hardenedThreshold: number;
  hardenedMinExecutions: number;
  testedThreshold: number;
  testedMinExecutions: number;
  /** Target wall-clock duration per subsystem in ms. */
  efficiencyTargetMs: number;
}

export const DEFAULT_SCORING_CONFIG: Readonly<ScoringConfig> = Object.freeze({
  autoRepairThreshold: 50,
  crystallizationThreshold: 90,
  crystallizationMinExecutions: 5,
  hardenedThreshold: 80,
  hardenedMinExecutions: 5,
  testedThreshold: 60,
  testedMinExecutions: 3,
  efficiencyTargetMs: 50,
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score a subsystem across its historical runs. Pure function — deterministic
 * for the same input runs. No side effects.
 */
export function scoreSubsystem(
  runs: readonly SubsystemRun[],
  config: Readonly<ScoringConfig> = DEFAULT_SCORING_CONFIG
): SubsystemScoreReport {
  if (runs.length === 0) {
    return {
      subsystem: 'unknown',
      rubric: { correctness: 0, completeness: 0, edgeCases: 0, efficiency: 0, reusability: 0 },
      total: 0,
      runCount: 0,
      maturity: 'draft',
      recommendation: 'monitor',
      narrative: 'No runs yet — subsystem is in draft state.',
    };
  }

  const name = runs[0].subsystem;

  // Correctness: verdicts that matched the MLRO override (or were not overridden).
  const correctRuns = runs.filter((r) => !r.mlroOverride || r.mlroOverride === r.verdict);
  const correctness = (correctRuns.length / runs.length) * 20;

  // Completeness: runs where `complete` was true.
  const completeRuns = runs.filter((r) => r.complete);
  const completeness = (completeRuns.length / runs.length) * 20;

  // Edge cases: runs that did NOT fail (never threw).
  const nonFailedRuns = runs.filter((r) => !r.failed);
  const edgeCases = (nonFailedRuns.length / runs.length) * 20;

  // Efficiency: fraction of runs under the target duration.
  const fastRuns = runs.filter((r) => r.durationMs <= config.efficiencyTargetMs);
  const efficiency = (fastRuns.length / runs.length) * 20;

  // Reusability: fraction of runs whose output was consumed downstream.
  const consumedRuns = runs.filter((r) => r.consumed);
  const reusability = (consumedRuns.length / runs.length) * 20;

  const rubric: RubricScore = {
    correctness: round(correctness),
    completeness: round(completeness),
    edgeCases: round(edgeCases),
    efficiency: round(efficiency),
    reusability: round(reusability),
  };
  const total = round(
    rubric.correctness +
      rubric.completeness +
      rubric.edgeCases +
      rubric.efficiency +
      rubric.reusability
  );

  // Maturity state transitions.
  let maturity: SubsystemScoreReport['maturity'] = 'draft';
  if (
    runs.length >= config.crystallizationMinExecutions &&
    total >= config.crystallizationThreshold
  ) {
    maturity = 'crystallized';
  } else if (runs.length >= config.hardenedMinExecutions && total >= config.hardenedThreshold) {
    maturity = 'hardened';
  } else if (runs.length >= config.testedMinExecutions && total >= config.testedThreshold) {
    maturity = 'tested';
  }

  // Recommendation.
  let recommendation: SubsystemScoreReport['recommendation'] = 'monitor';
  if (total < config.autoRepairThreshold) {
    recommendation = 'open_repair_task';
  } else if (maturity === 'crystallized') {
    recommendation = 'crystallize';
  } else if (maturity === 'hardened') {
    recommendation = 'ratify';
  }

  const narrative =
    `Subsystem ${name} scored ${total}/100 over ${runs.length} run(s). ` +
    `Maturity: ${maturity}. Recommendation: ${recommendation}. ` +
    `Rubric — correctness ${rubric.correctness}, completeness ${rubric.completeness}, ` +
    `edge cases ${rubric.edgeCases}, efficiency ${rubric.efficiency}, reusability ${rubric.reusability}.`;

  return {
    subsystem: name,
    rubric,
    total,
    runCount: runs.length,
    maturity,
    recommendation,
    narrative,
  };
}

// ---------------------------------------------------------------------------
// Asana repair task description — helper, not a side effect.
// ---------------------------------------------------------------------------

/**
 * Build an Asana task payload for a degraded subsystem. The caller
 * dispatches the actual task via asanaClient.createAsanaTask — this
 * module only constructs the payload so unit tests can run without
 * network calls.
 *
 * Regulatory basis: Cabinet Res 134/2025 Art.19 (internal review before
 * policy change) — degraded subsystems must go through a human before
 * any code change lands.
 */
export function buildRepairTaskPayload(report: SubsystemScoreReport): {
  name: string;
  notes: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
} {
  const priority: 'critical' | 'high' | 'medium' | 'low' =
    report.total < 30
      ? 'critical'
      : report.total < 50
        ? 'high'
        : report.total < 70
          ? 'medium'
          : 'low';
  return {
    name: `[BRAIN-REPAIR] Subsystem ${report.subsystem} degraded (${report.total}/100)`,
    notes:
      `The Weaponized Brain subsystem "${report.subsystem}" has scored ${report.total}/100 ` +
      `over ${report.runCount} recent run(s) — below the auto-repair threshold.\n\n` +
      `Rubric:\n` +
      `  - Correctness:   ${report.rubric.correctness}/20\n` +
      `  - Completeness:  ${report.rubric.completeness}/20\n` +
      `  - Edge cases:    ${report.rubric.edgeCases}/20\n` +
      `  - Efficiency:    ${report.rubric.efficiency}/20\n` +
      `  - Reusability:   ${report.rubric.reusability}/20\n\n` +
      `Maturity: ${report.maturity}\n` +
      `Recommendation: ${report.recommendation}\n\n` +
      `IMPORTANT: do NOT auto-rewrite the subsystem. Compliance logic ` +
      `cannot change without human review per Cabinet Res 134/2025 Art.19. ` +
      `A compliance engineer must audit the score history + recent telemetry ` +
      `before proposing a code change.`,
    priority,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
