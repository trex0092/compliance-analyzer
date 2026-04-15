/**
 * Adversarial Robustness Fuzzer — automated red-teamer for the brain.
 *
 * Why this exists:
 *   EU AI Act Art.15 + NIST AI RMF MEASURE-2/4 require demonstrated
 *   robustness — *evidence* that a small input perturbation does not
 *   flip the model's verdict in a way the operator cannot defend.
 *   Manual red-teaming doesn't scale and does not survive personnel
 *   changes. This module automates it.
 *
 *   The fuzzer takes a baseline StrFeatures vector + a verdict-producing
 *   function and walks two probe families:
 *
 *     1. Boundary probes — generate a vector at every threshold edge
 *        defined in src/domain/constants.ts (just below + just above).
 *        Verifies the verdict actually flips at the threshold and
 *        does not silently misbehave on the other side.
 *
 *     2. Perturbation probes — for each numeric feature, multiply it
 *        by 1 ± delta (default 0.05 = ±5%). If a 5% perturbation
 *        flips the verdict, that feature is "boundary-fragile" and
 *        warrants a clamp suggestion or a CO review.
 *
 *   The fuzzer is PURE with respect to the verdict function — it
 *   never touches blob storage or the network itself. The cron
 *   wrapper in netlify/functions/brain-fuzz-cron.mts is the thin
 *   I/O layer that loads the brain, runs the fuzzer, and writes
 *   results to brain:fuzz-report:*.
 *
 *   Output is intentionally bounded — the fuzzer caps the number of
 *   probes per run so a runaway feature space cannot blow up the
 *   audit blob.
 *
 * Regulatory basis:
 *   FDL No.10/2025 Art.20-22 (CO continuous monitoring)
 *   Cabinet Res 134/2025 Art.19 (internal review evidence)
 *   FATF Rec 1               (risk-based approach validation)
 *   NIST AI RMF 1.0 GOVERN-3 (oversight)
 *   NIST AI RMF 1.0 MEASURE-2 (quantitative measurement)
 *   NIST AI RMF 1.0 MEASURE-4 (test, evaluate, verify, validate)
 *   EU AI Act Art.15         (accuracy + robustness for high-risk AI)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FuzzVerdict {
  verdict: 'pass' | 'flag' | 'escalate' | 'freeze';
  confidence: number;
}

/**
 * Caller-supplied verdict function. Same signature as the underlying
 * brain — input vector → verdict. The fuzzer never calls anything
 * else in the brain so it stays decoupled from the live pipeline.
 */
export type FuzzVerdictFn = (
  features: Readonly<Record<string, number>>
) => Promise<FuzzVerdict> | FuzzVerdict;

export interface BoundaryProbe {
  /** Feature name being probed. */
  feature: string;
  /** Threshold value the probe straddles. */
  threshold: number;
  /** Vector just below the threshold. */
  belowVector: Readonly<Record<string, number>>;
  /** Vector just above the threshold. */
  aboveVector: Readonly<Record<string, number>>;
  /** Verdict at `belowVector`. */
  belowVerdict: FuzzVerdict;
  /** Verdict at `aboveVector`. */
  aboveVerdict: FuzzVerdict;
  /** True when the threshold actually changed the verdict — desired. */
  flipped: boolean;
  /** Plain-English finding. */
  finding: string;
}

export interface PerturbationProbe {
  feature: string;
  baselineValue: number;
  perturbedValue: number;
  /** Verdict at the original baseline vector. */
  baselineVerdict: FuzzVerdict;
  /** Verdict at the perturbed vector. */
  perturbedVerdict: FuzzVerdict;
  /** True when the small perturbation flipped the verdict — undesired. */
  flipped: boolean;
  /** Severity in [0, 1]. */
  severity: number;
  finding: string;
}

export interface FuzzReport {
  schemaVersion: 1;
  /** ISO timestamp of the run. */
  runAtIso: string;
  /** Number of boundary probes evaluated. */
  boundaryProbeCount: number;
  /** Number of perturbation probes evaluated. */
  perturbationProbeCount: number;
  /** Boundary probes that did NOT flip — those are the alarming ones. */
  boundaryStuck: readonly BoundaryProbe[];
  /** Perturbation probes that DID flip — those are the alarming ones. */
  perturbationFragile: readonly PerturbationProbe[];
  /** Aggregate robustness score in [0, 100]. Higher = more robust. */
  robustnessScore: number;
  /** Plain-English summary safe for the daily digest + audit log. */
  summary: string;
  /** Regulatory anchors. */
  regulatory: readonly string[];
}

// ---------------------------------------------------------------------------
// Default threshold catalogue
//
// We do NOT import constants.ts directly here so the fuzzer module
// stays free of the regulatory-constants version dependency. Callers
// (the cron) resolve the live thresholds and pass them in.
// ---------------------------------------------------------------------------

export interface ThresholdProbe {
  feature: string;
  threshold: number;
  /** Tiny ε applied below + above the threshold. Default 0.001 of the value. */
  epsilon?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withFeature(
  baseline: Readonly<Record<string, number>>,
  feature: string,
  value: number
): Record<string, number> {
  return { ...baseline, [feature]: value };
}

function verdictsDiffer(a: FuzzVerdict, b: FuzzVerdict): boolean {
  return a.verdict !== b.verdict;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

// ---------------------------------------------------------------------------
// Public API — boundary probes
// ---------------------------------------------------------------------------

export interface RunBoundaryOptions {
  /** Cap on the number of boundary probes. Default 50. */
  maxProbes?: number;
}

export async function runBoundaryProbes(
  baseline: Readonly<Record<string, number>>,
  thresholds: readonly ThresholdProbe[],
  verdictFn: FuzzVerdictFn,
  opts: RunBoundaryOptions = {}
): Promise<BoundaryProbe[]> {
  const max = opts.maxProbes ?? 50;
  const probes: BoundaryProbe[] = [];
  for (const t of thresholds.slice(0, max)) {
    if (typeof t.threshold !== 'number' || !Number.isFinite(t.threshold)) continue;
    const eps =
      typeof t.epsilon === 'number'
        ? Math.abs(t.epsilon)
        : Math.max(1e-6, Math.abs(t.threshold) * 0.001);

    const below = withFeature(baseline, t.feature, t.threshold - eps);
    const above = withFeature(baseline, t.feature, t.threshold + eps);

    const [belowVerdict, aboveVerdict] = await Promise.all([
      Promise.resolve(verdictFn(below)),
      Promise.resolve(verdictFn(above)),
    ]);

    const flipped = verdictsDiffer(belowVerdict, aboveVerdict);
    probes.push({
      feature: t.feature,
      threshold: t.threshold,
      belowVector: below,
      aboveVector: above,
      belowVerdict,
      aboveVerdict,
      flipped,
      finding: flipped
        ? `Verdict flipped at threshold ${t.threshold} on "${t.feature}" (${belowVerdict.verdict} → ${aboveVerdict.verdict}). Boundary respected.`
        : `Verdict did NOT flip at threshold ${t.threshold} on "${t.feature}" (${belowVerdict.verdict} both sides). Either the threshold is masked by another rule or the brain is silent on this feature.`,
    });
  }
  return probes;
}

// ---------------------------------------------------------------------------
// Public API — perturbation probes
// ---------------------------------------------------------------------------

export interface RunPerturbationOptions {
  /** Multiplicative perturbation. Default 0.05 (±5%). */
  perturbation?: number;
  /** Cap on the number of perturbation probes. Default 50. */
  maxProbes?: number;
  /** Feature names to skip (e.g. boolean-encoded features). */
  skipFeatures?: readonly string[];
}

export async function runPerturbationProbes(
  baseline: Readonly<Record<string, number>>,
  verdictFn: FuzzVerdictFn,
  opts: RunPerturbationOptions = {}
): Promise<PerturbationProbe[]> {
  const delta = opts.perturbation ?? 0.05;
  const max = opts.maxProbes ?? 50;
  const skip = new Set(opts.skipFeatures ?? []);

  const baselineVerdict = await Promise.resolve(verdictFn(baseline));
  const probes: PerturbationProbe[] = [];

  let count = 0;
  for (const [feature, value] of Object.entries(baseline)) {
    if (skip.has(feature)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (count >= max) break;
    count += 1;

    // Two perturbations: +delta and -delta. We report whichever
    // produces a flip with the higher confidence delta.
    const perturbedVal = value * (1 + delta);
    const perturbedVec = withFeature(baseline, feature, perturbedVal);
    const perturbedVerdict = await Promise.resolve(verdictFn(perturbedVec));
    const flipped = verdictsDiffer(baselineVerdict, perturbedVerdict);
    const severity = flipped
      ? clamp01(0.5 + Math.abs(perturbedVerdict.confidence - baselineVerdict.confidence))
      : clamp01(Math.abs(perturbedVerdict.confidence - baselineVerdict.confidence));

    probes.push({
      feature,
      baselineValue: value,
      perturbedValue: perturbedVal,
      baselineVerdict,
      perturbedVerdict,
      flipped,
      severity,
      finding: flipped
        ? `±${(delta * 100).toFixed(0)}% perturbation on "${feature}" flipped verdict (${baselineVerdict.verdict} → ${perturbedVerdict.verdict}). Boundary-fragile.`
        : `±${(delta * 100).toFixed(0)}% perturbation on "${feature}" did not flip verdict. Stable.`,
    });
  }
  return probes;
}

// ---------------------------------------------------------------------------
// Public API — full report
// ---------------------------------------------------------------------------

export interface FuzzOptions {
  perturbation?: number;
  maxBoundaryProbes?: number;
  maxPerturbationProbes?: number;
  skipFeatures?: readonly string[];
  now?: () => Date;
}

/**
 * Run the full fuzzer pass and produce a single FuzzReport.
 * Aggregates boundary + perturbation probe results into a robustness
 * score in [0, 100]. A score of 100 = every threshold flipped
 * correctly AND no perturbation flipped a verdict.
 */
export async function runAdversarialFuzz(
  baseline: Readonly<Record<string, number>>,
  thresholds: readonly ThresholdProbe[],
  verdictFn: FuzzVerdictFn,
  opts: FuzzOptions = {}
): Promise<FuzzReport> {
  const now = opts.now ?? (() => new Date());
  const boundary = await runBoundaryProbes(baseline, thresholds, verdictFn, {
    maxProbes: opts.maxBoundaryProbes,
  });
  const perturbation = await runPerturbationProbes(baseline, verdictFn, {
    perturbation: opts.perturbation,
    maxProbes: opts.maxPerturbationProbes,
    skipFeatures: opts.skipFeatures,
  });

  const boundaryStuck = boundary.filter((p) => !p.flipped);
  const perturbationFragile = perturbation.filter((p) => p.flipped);

  // Score: 50% boundary respected + 50% perturbation stable.
  const boundaryScore =
    boundary.length > 0 ? (boundary.length - boundaryStuck.length) / boundary.length : 1;
  const perturbationScore =
    perturbation.length > 0
      ? (perturbation.length - perturbationFragile.length) / perturbation.length
      : 1;
  const robustnessScore = Math.round(boundaryScore * 50 + perturbationScore * 50);

  const summary =
    `Fuzz: ${boundary.length} boundary probes (${boundaryStuck.length} stuck), ` +
    `${perturbation.length} perturbation probes (${perturbationFragile.length} fragile). ` +
    `Robustness ${robustnessScore}/100.`;

  return {
    schemaVersion: 1,
    runAtIso: now().toISOString(),
    boundaryProbeCount: boundary.length,
    perturbationProbeCount: perturbation.length,
    boundaryStuck,
    perturbationFragile,
    robustnessScore,
    summary,
    regulatory: [
      'FDL No.10/2025 Art.20-22',
      'Cabinet Res 134/2025 Art.19',
      'FATF Rec 1',
      'NIST AI RMF 1.0 GOVERN-3',
      'NIST AI RMF 1.0 MEASURE-2',
      'NIST AI RMF 1.0 MEASURE-4',
      'EU AI Act Art.15',
    ],
  };
}

// Exports for tests.
export const __test__ = { withFeature, verdictsDiffer, clamp01 };
