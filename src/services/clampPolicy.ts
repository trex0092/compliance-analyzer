/**
 * Clamp Policy — single source of truth for weaponized brain clamp thresholds.
 *
 * Phase 2 weaponization extracts every hardcoded clamp threshold from
 * weaponizedBrain.ts into this module so that regulatory updates become
 * a one-file change. Each threshold is documented with its citation.
 *
 * CRITICAL RULE: do NOT move values from src/domain/constants.ts here.
 * This file contains SUBSYSTEM-level clamp tuning (severity bands,
 * escalation triggers), not the regulatory constants themselves. When a
 * regulation changes (e.g. Cabinet Decision 109/2023 amends the 25% UBO
 * threshold), update src/domain/constants.ts first; this file references
 * the constant.
 *
 * Regulatory basis:
 *   - Cabinet Res 74/2020 Art.4-7 (freeze protocol)
 *   - Cabinet Decision 109/2023 (UBO 25% threshold)
 *   - MoE Circular 08/AML/2021 (DPMS structuring red flags)
 *   - FATF Rec 10, 15, 18 (CDD, VASP, internal controls)
 *   - FDL No.10/2025 Art.20-21, 24, 26-27 (CO duties, retention, STR)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClampPolicy {
  /** Percentage of UBO ownership that must be disclosed to avoid escalate. */
  uboUndisclosedEscalateAbovePct: number;

  /**
   * Minimum count of critical-impact adverse media hits that triggers
   * an escalate clamp. 1 is the regulatory default — any confirmed
   * critical-category hit is enough.
   */
  adverseMediaCriticalEscalateCount: number;

  /**
   * Minimum number of confirmed sanctioned/illicit wallets that triggers
   * a freeze clamp. 1 is the regulatory default — any confirmed hit on
   * a VASP-listed wallet is a confirmed sanction match.
   */
  walletConfirmedFreezeCount: number;

  /**
   * Confidence cap applied when any subsystem failure is recorded. The
   * decision record is incomplete so confidence must be capped.
   */
  subsystemFailureConfidenceCap: number;

  /** Confidence cap applied when a critical adverse-media category is detected. */
  adverseMediaCriticalConfidenceCap: number;

  /** Confidence cap applied when a sanctioned UBO is detected. */
  sanctionedUboConfidenceCap: number;

  /** Confidence cap applied when a confirmed wallet hit is detected. */
  walletConfirmedConfidenceCap: number;

  /**
   * Threshold below which the contradiction detector flags inter-subsystem
   * contradictions as material. Range [0,1]; 0.5 = "subsystems disagree by
   * at least 50% on the verdict rank".
   */
  contradictionEscalateThreshold: number;

  /**
   * Threshold above which the narrative drift detector flags a generated
   * STR narrative as boilerplate-drift. Cosine distance in [0,1]; 0.35
   * empirically catches template reuse without false-positive on novel
   * language.
   */
  narrativeDriftThreshold: number;

  /**
   * Minimum typology match score for the sanctions-evasion typology matcher
   * to flag a typology hit. Range [0,1]; 0.7 catches clear patterns without
   * false-positives on incidental overlaps.
   */
  typologyMatchThreshold: number;

  /**
   * Minimum temporal pattern correlation for the 90-day detector to flag
   * a pattern as material. Range [0,1]; 0.6 is the empirical threshold
   * for "persistent pattern" vs "noise".
   */
  temporalPatternThreshold: number;

  /**
   * Window size for the temporal pattern detector, in days. FATF Rec 10
   * suggests 90 days for cross-transaction pattern detection.
   */
  temporalWindowDays: number;
}

// ---------------------------------------------------------------------------
// Default policy — the production values, each with a regulatory citation.
// ---------------------------------------------------------------------------

export const DEFAULT_CLAMP_POLICY: Readonly<ClampPolicy> = Object.freeze({
  // Cabinet Decision 109/2023: undisclosed UBO portion > 25% requires EDD.
  uboUndisclosedEscalateAbovePct: 25,

  // FATF Rec 10 + Cabinet Res 134/2025 Art.14: any critical hit is EDD trigger.
  adverseMediaCriticalEscalateCount: 1,

  // Cabinet Res 74/2020 Art.4-7 + FATF Rec 15: any confirmed VASP hit = freeze.
  walletConfirmedFreezeCount: 1,

  // FDL Art.24: incomplete records cannot be trusted at high confidence.
  subsystemFailureConfidenceCap: 0.5,

  // Conservative confidence caps — the brain reports what it's sure of,
  // and a critical-category signal is enough to reduce certainty.
  adverseMediaCriticalConfidenceCap: 0.5,
  sanctionedUboConfidenceCap: 0.4,
  walletConfirmedConfidenceCap: 0.3,

  // Phase 2 subsystems (contradiction, narrative drift, typology, temporal)
  // — empirically tuned, documented in subsystem source files.
  contradictionEscalateThreshold: 0.5,
  narrativeDriftThreshold: 0.35,
  typologyMatchThreshold: 0.7,
  temporalPatternThreshold: 0.6,
  temporalWindowDays: 90,
});

// ---------------------------------------------------------------------------
// Policy loader — allows deployments to override specific thresholds.
// ---------------------------------------------------------------------------

/**
 * Merge a partial policy override with the default policy. Any threshold
 * omitted from the override falls through to the default. Returns a new
 * frozen object; the caller cannot mutate it.
 *
 * Use this to hand a modified policy to runWeaponizedBrain() without
 * changing the code path (e.g. for backtest runs with loosened clamps).
 */
export function mergeClampPolicy(override?: Partial<ClampPolicy>): Readonly<ClampPolicy> {
  if (!override) return DEFAULT_CLAMP_POLICY;
  return Object.freeze({ ...DEFAULT_CLAMP_POLICY, ...override });
}
